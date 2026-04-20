from datetime import datetime
from typing import Any, Optional
from uuid import uuid4

from models.alert_model import create_alert
from models.appointment_model import create_appointment_record, get_appointment_by_id, list_appointments, update_appointment_record
from models.base import utc_now
from models.patient_model import get_patient_by_user_id, update_patient_profile, upsert_visit_history_entry
from models.user_model import DEFAULT_HOSPITAL_ID, get_doctor_by_id, get_user_by_id, list_users_by_role, sanitize_user, update_user_fields
from services.clinical_safety_service import build_clinical_safety_snapshot
from services.doctor_copilot_service import enrich_appointments_with_copilot
from services.doctor_routing_service import get_specialty_label


class ValidationError(ValueError):
    pass


APPOINTMENT_STATUSES = {"requested", "confirmed", "in_consultation", "completed", "cancelled"}
SAFETY_WORKFLOW_STATUSES = {"open", "acknowledged", "monitoring", "escalated", "resolved"}
BOOKING_SLOT_STATUSES = {"open", "blocked"}


def _hospital_id(user: dict[str, Any]) -> str:
    return user.get("hospital_id") or DEFAULT_HOSPITAL_ID


def _default_safety_workflow() -> dict[str, Any]:
    return {
        "safety_workflow_status": "open",
        "safety_workflow_note": "",
        "safety_workflow_updated_at": None,
        "safety_workflow_updated_by": "",
        "safety_workflow_updated_by_user_id": "",
        "safety_workflow_history": [],
    }


def _normalize_safety_workflow(appointment: dict[str, Any]) -> dict[str, Any]:
    defaults = _default_safety_workflow()
    return {
        **appointment,
        **{
            key: appointment.get(key) if appointment.get(key) is not None else value
            for key, value in defaults.items()
        },
    }


def _trimmed_text(value: Any) -> str:
    return " ".join(str(value or "").split()).strip()


def _parse_slot_datetime(date_value: str, time_value: str) -> Optional[datetime]:
    if not date_value or not time_value:
        return None
    try:
        return datetime.strptime(f"{date_value} {time_value}", "%Y-%m-%d %I:%M %p")
    except ValueError:
        return None


def _is_upcoming_slot(slot: dict[str, Any]) -> bool:
    slot_datetime = _parse_slot_datetime(slot.get("date", ""), slot.get("time", ""))
    if not slot_datetime:
        return True
    return slot_datetime >= datetime.now()


def _normalize_booking_slot(raw_slot: dict[str, Any]) -> Optional[dict[str, Any]]:
    date_value = (raw_slot.get("date") or "").strip()
    time_value = (raw_slot.get("time") or "").strip()
    if not date_value or not time_value:
        return None

    status = (raw_slot.get("status") or "open").strip().lower()
    if status not in BOOKING_SLOT_STATUSES:
        status = "open"

    capacity = raw_slot.get("capacity") or 1
    try:
        capacity = max(1, int(capacity))
    except (TypeError, ValueError):
        capacity = 1

    return {
        "id": str(raw_slot.get("id") or uuid4().hex[:12]),
        "date": date_value,
        "time": time_value,
        "label": _trimmed_text(raw_slot.get("label") or ""),
        "location": _trimmed_text(raw_slot.get("location") or ""),
        "capacity": capacity,
        "status": status,
    }


def _normalized_doctor_slots(doctor: Optional[dict[str, Any]]) -> list[dict[str, Any]]:
    if not doctor:
        return []

    slots: list[dict[str, Any]] = []
    for raw_slot in doctor.get("booking_slots") or []:
        normalized = _normalize_booking_slot(raw_slot if isinstance(raw_slot, dict) else {})
        if normalized:
            slots.append(normalized)

    slots.sort(key=lambda slot: (slot.get("date", ""), slot.get("time", "")))
    return slots


def _active_slot_booking_count(appointments: list[dict[str, Any]], slot: dict[str, Any]) -> int:
    target_date = slot.get("date")
    target_time = slot.get("time")
    return len(
        [
            appointment
            for appointment in appointments
            if appointment.get("appointment_date") == target_date
            and appointment.get("appointment_time") == target_time
            and appointment.get("status") != "cancelled"
        ]
    )


def _serialize_slot_with_bookings(slot: dict[str, Any], appointments: list[dict[str, Any]]) -> dict[str, Any]:
    booked_count = _active_slot_booking_count(appointments, slot)
    capacity = slot.get("capacity") or 1
    available_count = max(capacity - booked_count, 0)
    return {
        **slot,
        "booked_count": booked_count,
        "available_count": available_count,
        "is_available": slot.get("status") == "open" and available_count > 0 and _is_upcoming_slot(slot),
    }


def _build_safety_workflow_history_entry(*, status: str, note: str, user: dict[str, Any]) -> dict[str, Any]:
    return {
        "status": status,
        "note": note,
        "actor_name": user.get("name", ""),
        "actor_role": user.get("role", ""),
        "actor_user_id": str(user.get("_id", "")),
        "created_at": utc_now(),
    }


def _appointment_safety_snapshot(appointment: dict[str, Any]) -> dict[str, Any]:
    patient_user_id = appointment.get("patient_user_id")
    if not patient_user_id:
        return {"clinical_alert_level": "Low", "safety_flags": [], "safety_recommendation": ""}
    patient = get_patient_by_user_id(patient_user_id) or {}
    if not patient:
        return {"clinical_alert_level": "Low", "safety_flags": [], "safety_recommendation": ""}
    return build_clinical_safety_snapshot(patient)


def list_doctor_directory(user: dict[str, Any], *, specialty: Optional[str] = None) -> list[dict[str, Any]]:
    doctors = list_users_by_role("doctor", hospital_id=_hospital_id(user))
    normalized_specialty = (specialty or "").strip().lower()
    if normalized_specialty:
        doctors = [doctor for doctor in doctors if (doctor.get("specialty") or "").lower() == normalized_specialty]

    hospital_appointments = list_appointments(hospital_id=_hospital_id(user))

    directory = []
    for doctor in doctors:
        safe_doctor = sanitize_user(doctor) or {}
        doctor_appointments = [
            appointment for appointment in hospital_appointments if appointment.get("assigned_doctor_id") == safe_doctor.get("id")
        ]
        open_slots = [
            slot
            for slot in (_serialize_slot_with_bookings(slot, doctor_appointments) for slot in _normalized_doctor_slots(doctor))
            if slot.get("is_available")
        ]
        next_open_slot = open_slots[0] if open_slots else None
        directory.append(
            {
                "id": safe_doctor.get("id"),
                "name": safe_doctor.get("name"),
                "email": safe_doctor.get("email"),
                "specialty": safe_doctor.get("specialty"),
                "specialty_label": get_specialty_label(safe_doctor.get("specialty")),
                "doctor_code": safe_doctor.get("doctor_code"),
                "hospital_id": safe_doctor.get("hospital_id"),
                "open_slot_count": len(open_slots),
                "next_open_slot": next_open_slot,
                "booking_locations": sorted({slot.get("location") for slot in open_slots if slot.get("location")}),
            }
        )
    return directory


def get_doctor_slot_catalog(user: dict[str, Any], *, doctor_id: str) -> dict[str, Any]:
    if not doctor_id:
        raise ValidationError("Please choose a doctor first.")

    hospital_id = _hospital_id(user)
    doctor = get_doctor_by_id(doctor_id, hospital_id=hospital_id)
    if not doctor:
        raise ValidationError("Doctor not found.")

    doctor_appointments = list_appointments(hospital_id=hospital_id, assigned_doctor_id=doctor_id)
    slots = [_serialize_slot_with_bookings(slot, doctor_appointments) for slot in _normalized_doctor_slots(doctor)]
    return {
        "doctor": {
            "id": str(doctor.get("_id")),
            "name": doctor.get("name", ""),
            "specialty": doctor.get("specialty"),
            "specialty_label": get_specialty_label(doctor.get("specialty")),
            "doctor_code": doctor.get("doctor_code"),
        },
        "slots": slots,
    }


def update_doctor_slot_schedule(payload: dict[str, Any], user: dict[str, Any]) -> dict[str, Any]:
    if user.get("role") not in {"doctor", "hospital_admin"}:
        raise ValidationError("Only clinicians can update doctor slots.")

    doctor_id = (payload.get("doctor_id") or "").strip() or str(user.get("_id") or "")
    hospital_id = _hospital_id(user)
    doctor = get_doctor_by_id(doctor_id, hospital_id=hospital_id)
    if not doctor:
        raise ValidationError("Doctor not found for slot update.")

    if user.get("role") == "doctor" and str(doctor.get("_id")) != str(user.get("_id")):
        raise ValidationError("You can only update your own slot schedule.")

    raw_slots = payload.get("slots")
    if not isinstance(raw_slots, list):
        raise ValidationError("Slots payload must be a list.")

    normalized_slots: list[dict[str, Any]] = []
    seen_slot_keys: set[tuple[str, str, str]] = set()
    for raw_slot in raw_slots[:120]:
        normalized = _normalize_booking_slot(raw_slot if isinstance(raw_slot, dict) else {})
        if not normalized:
            continue
        unique_key = (normalized["date"], normalized["time"], normalized["location"])
        if unique_key in seen_slot_keys:
            continue
        seen_slot_keys.add(unique_key)
        normalized_slots.append(normalized)

    update_user_fields(str(doctor["_id"]), set_fields={"booking_slots": normalized_slots})
    refreshed = get_doctor_by_id(str(doctor["_id"]), hospital_id=hospital_id)
    return {
        "doctor": sanitize_user(refreshed) or {},
        "slots": [_serialize_slot_with_bookings(slot, list_appointments(hospital_id=hospital_id, assigned_doctor_id=str(doctor["_id"]))) for slot in _normalized_doctor_slots(refreshed)],
    }


def _validate_appointment_payload(payload: dict[str, Any]) -> dict[str, str]:
    doctor_id = (payload.get("doctor_id") or "").strip()
    slot_id = (payload.get("slot_id") or "").strip()
    appointment_date = (payload.get("appointment_date") or "").strip()
    appointment_time = (payload.get("appointment_time") or "").strip()
    reason = " ".join((payload.get("reason") or "").strip().split())
    notes = " ".join((payload.get("notes") or "").strip().split())

    if not doctor_id:
        raise ValidationError("Please choose a doctor.")
    if not slot_id:
        if not appointment_date:
            raise ValidationError("Please choose an appointment date.")
        if not appointment_time:
            raise ValidationError("Please choose an appointment time.")
    if len(reason) < 3:
        raise ValidationError("Please add a short reason for the visit.")

    return {
        "doctor_id": doctor_id,
        "slot_id": slot_id,
        "appointment_date": appointment_date,
        "appointment_time": appointment_time,
        "reason": reason,
        "notes": notes,
    }


def create_patient_appointment(payload: dict[str, Any], user: dict[str, Any]) -> dict[str, Any]:
    if user.get("role") != "patient":
        raise ValidationError("Only patients can create appointments.")

    validated = _validate_appointment_payload(payload)
    hospital_id = _hospital_id(user)
    doctor = get_doctor_by_id(validated["doctor_id"], hospital_id=hospital_id)
    if not doctor:
        raise ValidationError("The selected doctor is not available in this hospital.")

    selected_slot = None
    if validated.get("slot_id"):
        doctor_appointments = list_appointments(hospital_id=hospital_id, assigned_doctor_id=str(doctor["_id"]))
        selected_slot = next((slot for slot in _normalized_doctor_slots(doctor) if slot.get("id") == validated["slot_id"]), None)
        if not selected_slot:
            raise ValidationError("That slot is no longer available. Please choose another one.")
        serialized_slot = _serialize_slot_with_bookings(selected_slot, doctor_appointments)
        if not serialized_slot.get("is_available"):
            raise ValidationError("That slot has already been taken. Please choose another one.")
        validated["appointment_date"] = selected_slot.get("date", "")
        validated["appointment_time"] = selected_slot.get("time", "")
    else:
        conflicting = [
            appointment
            for appointment in list_appointments(hospital_id=hospital_id, assigned_doctor_id=str(doctor["_id"]))
            if appointment.get("appointment_date") == validated["appointment_date"]
            and appointment.get("appointment_time") == validated["appointment_time"]
            and appointment.get("status") != "cancelled"
        ]
        if conflicting:
            raise ValidationError("That appointment time is already booked. Please choose another slot.")

    patient_profile = get_patient_by_user_id(str(user["_id"])) or {}
    appointment = create_appointment_record(
        {
            "hospital_id": hospital_id,
            "patient_user_id": str(user["_id"]),
            "patient_name": user.get("name"),
            "patient_email": user.get("email"),
            "patient_phone": patient_profile.get("phone", ""),
            "patient_age": patient_profile.get("age"),
            "appointment_date": validated["appointment_date"],
            "appointment_time": validated["appointment_time"],
            "preferred_slot": f"{validated['appointment_date']} {validated['appointment_time']}",
            "slot_id": selected_slot.get("id") if selected_slot else validated.get("slot_id") or None,
            "slot_label": selected_slot.get("label") if selected_slot else "",
            "appointment_location": selected_slot.get("location") if selected_slot else "",
            "reason": validated["reason"],
            "patient_notes": validated["notes"],
            "status": "requested",
            "requested_specialty": doctor.get("specialty"),
            "assigned_doctor_id": str(doctor["_id"]),
            "assigned_doctor_name": doctor.get("name", ""),
            "assigned_doctor_specialty": doctor.get("specialty", ""),
            "assigned_doctor_code": doctor.get("doctor_code"),
            "consultation_notes": "",
            "diagnosis_summary": "",
            "vitals_summary": "",
            "prescription_summary": "",
            "scan_summary": "",
            "follow_up_plan": "",
            "consultation_started_at": None,
            "completed_at": None,
            **_default_safety_workflow(),
        }
    )

    update_patient_profile(
        str(user["_id"]),
        {
            "status": "Appointment requested",
                "assigned_doctor_id": str(doctor["_id"]),
                "assigned_doctor_name": doctor.get("name", ""),
                "assigned_doctor_specialty": doctor.get("specialty", ""),
                "preferred_appointment_slot": validated["preferred_slot"] if "preferred_slot" in validated else f"{validated['appointment_date']} {validated['appointment_time']}",
                "appointment_location": selected_slot.get("location") if selected_slot else "",
                "appointment_reason": validated["reason"],
            },
        increment={"appointments_requested": 1},
    )

    alert_payload = {
        "type": "appointment_request",
        "title": "New appointment request",
        "message": f"{user.get('name')} booked an appointment with {doctor.get('name')}.",
        "hospital_id": hospital_id,
        "severity": "medium",
        "patient_user_id": str(user["_id"]),
        "patient_name": user.get("name"),
        "patient_email": user.get("email"),
        "assigned_doctor_id": str(doctor["_id"]),
        "assigned_doctor_name": doctor.get("name", ""),
        "source": "appointment",
    }
    create_alert({**alert_payload, "target_role": "hospital_admin"})
    create_alert({**alert_payload, "target_role": "doctor", "target_user_id": str(doctor["_id"])})
    return appointment


def create_chat_appointment_request(
    *,
    user: Optional[dict[str, Any]],
    details: dict[str, Any],
    hospital_id: str,
    doctor: Optional[dict[str, Any]],
) -> Optional[dict[str, Any]]:
    if not user or user.get("role") != "patient" or not doctor:
        return None

    preferred_slot = details.get("preferred_slot", "")
    date_part, time_part = "", ""
    if preferred_slot:
        parts = preferred_slot.split(" ", 1)
        if len(parts) == 2:
            date_part, time_part = parts
        else:
            date_part = preferred_slot

    return create_appointment_record(
        {
            "hospital_id": hospital_id,
            "patient_user_id": str(user["_id"]),
            "patient_name": details.get("name") or user.get("name"),
            "patient_email": user.get("email"),
            "patient_phone": details.get("phone", ""),
            "patient_age": int(details["age"]) if details.get("age") else None,
            "appointment_date": date_part,
            "appointment_time": time_part,
            "preferred_slot": preferred_slot,
            "reason": details.get("reason", ""),
            "patient_notes": details.get("initial_request", ""),
            "status": "requested",
            "requested_specialty": doctor.get("specialty"),
            "assigned_doctor_id": str(doctor["_id"]),
            "assigned_doctor_name": doctor.get("name", ""),
            "assigned_doctor_specialty": doctor.get("specialty", ""),
            "assigned_doctor_code": doctor.get("doctor_code"),
            "consultation_notes": "",
            "diagnosis_summary": "",
            "vitals_summary": "",
            "prescription_summary": "",
            "scan_summary": "",
            "follow_up_plan": "",
            "consultation_started_at": None,
            "completed_at": None,
            **_default_safety_workflow(),
        }
    )


def get_appointment_records(user: dict[str, Any]) -> list[dict[str, Any]]:
    role = user.get("role")
    if role == "patient":
        return [_normalize_safety_workflow(appointment) for appointment in list_appointments(patient_user_id=str(user["_id"]))]
    if role == "doctor":
        appointments = list_appointments(hospital_id=_hospital_id(user), assigned_doctor_id=str(user["_id"]))
        return [_normalize_safety_workflow(appointment) for appointment in enrich_appointments_with_copilot(appointments)]

    appointments = list_appointments(hospital_id=_hospital_id(user))
    return [_normalize_safety_workflow(appointment) for appointment in enrich_appointments_with_copilot(appointments)]


def update_clinician_appointment(appointment_id: str, payload: dict[str, Any], user: dict[str, Any]) -> dict[str, Any]:
    appointment = _normalize_safety_workflow(get_appointment_by_id(appointment_id) or {})
    if not appointment:
        raise ValidationError("Appointment not found.")

    if user.get("role") == "doctor" and appointment.get("assigned_doctor_id") != str(user["_id"]):
        raise ValidationError("You can only update your own appointments.")
    if user.get("role") not in {"doctor", "hospital_admin"}:
        raise ValidationError("Only clinicians can update appointments.")

    status = (payload.get("status") or appointment.get("status") or "").strip().lower()
    if status and status not in APPOINTMENT_STATUSES:
        raise ValidationError("Appointment status is invalid.")

    incoming_workflow_status = (payload.get("safety_workflow_status") or appointment.get("safety_workflow_status") or "open").strip().lower()
    if incoming_workflow_status not in SAFETY_WORKFLOW_STATUSES:
        raise ValidationError("Safety workflow status is invalid.")

    incoming_workflow_note = _trimmed_text(
        payload.get("safety_workflow_note")
        if "safety_workflow_note" in payload
        else appointment.get("safety_workflow_note")
    )

    safety_snapshot = _appointment_safety_snapshot(appointment)
    safety_level = (safety_snapshot.get("clinical_alert_level") or "Low").lower()
    requires_closed_loop_note = safety_level in {"high", "critical"}
    incoming_date = (payload.get("appointment_date") or appointment.get("appointment_date") or "").strip()
    incoming_time = (payload.get("appointment_time") or appointment.get("appointment_time") or "").strip()
    incoming_slot_id = (payload.get("slot_id") or appointment.get("slot_id") or "").strip()
    incoming_location = _trimmed_text(payload.get("appointment_location") or appointment.get("appointment_location") or "")

    if payload.get("appointment_date") or payload.get("appointment_time"):
        conflicting = [
            candidate
            for candidate in list_appointments(
                hospital_id=appointment.get("hospital_id"),
                assigned_doctor_id=appointment.get("assigned_doctor_id"),
            )
            if candidate.get("id") != appointment_id
            and candidate.get("appointment_date") == incoming_date
            and candidate.get("appointment_time") == incoming_time
            and candidate.get("status") != "cancelled"
        ]
        if conflicting:
            raise ValidationError("That rescheduled slot is already booked.")

    updates = {
        "status": status or appointment.get("status") or "requested",
        "appointment_date": incoming_date,
        "appointment_time": incoming_time,
        "preferred_slot": f"{incoming_date} {incoming_time}".strip(),
        "slot_id": incoming_slot_id or None,
        "appointment_location": incoming_location,
        "consultation_notes": _trimmed_text(payload.get("consultation_notes") or appointment.get("consultation_notes") or ""),
        "diagnosis_summary": _trimmed_text(payload.get("diagnosis_summary") or appointment.get("diagnosis_summary") or ""),
        "vitals_summary": _trimmed_text(payload.get("vitals_summary") or appointment.get("vitals_summary") or ""),
        "prescription_summary": _trimmed_text(payload.get("prescription_summary") or appointment.get("prescription_summary") or ""),
        "scan_summary": _trimmed_text(payload.get("scan_summary") or appointment.get("scan_summary") or ""),
        "follow_up_plan": _trimmed_text(payload.get("follow_up_plan") or appointment.get("follow_up_plan") or ""),
        "clinician_updated_by": user.get("name"),
        "clinician_updated_by_user_id": str(user["_id"]),
        "safety_workflow_status": incoming_workflow_status,
        "safety_workflow_note": incoming_workflow_note,
    }

    history = list(appointment.get("safety_workflow_history") or [])
    workflow_changed = incoming_workflow_status != (appointment.get("safety_workflow_status") or "open")
    note_changed = incoming_workflow_note != (appointment.get("safety_workflow_note") or "")
    if workflow_changed or note_changed:
        history.insert(
            0,
            _build_safety_workflow_history_entry(
                status=incoming_workflow_status,
                note=incoming_workflow_note,
                user=user,
            ),
        )
        updates["safety_workflow_history"] = history[:10]
        updates["safety_workflow_updated_at"] = utc_now()
        updates["safety_workflow_updated_by"] = user.get("name", "")
        updates["safety_workflow_updated_by_user_id"] = str(user["_id"])

    if requires_closed_loop_note and updates["status"] == "completed":
        if incoming_workflow_status == "open":
            raise ValidationError("High-risk appointments need a safety workflow action before completion.")
        if len(incoming_workflow_note) < 12:
            raise ValidationError("Add a short clinical safety closure note before completing this high-risk visit.")

    if updates["status"] == "in_consultation" and not appointment.get("consultation_started_at"):
        updates["consultation_started_at"] = utc_now()
    if updates["status"] == "completed":
        updates["completed_at"] = utc_now()

    updated = update_appointment_record(appointment_id, updates)
    if not updated:
        raise ValidationError("Unable to update the appointment.")

    updated = _normalize_safety_workflow(updated)

    if incoming_workflow_status == "escalated" and workflow_changed:
        alert_payload = {
            "type": "clinical_safety_escalation",
            "title": "Clinical safety escalation",
            "message": f"{updated.get('patient_name') or 'Patient'} was escalated for review. {incoming_workflow_note or safety_snapshot.get('safety_recommendation') or ''}".strip(),
            "hospital_id": updated.get("hospital_id"),
            "severity": "high" if safety_level == "high" else "critical" if safety_level == "critical" else "medium",
            "patient_user_id": updated.get("patient_user_id"),
            "patient_name": updated.get("patient_name"),
            "patient_email": updated.get("patient_email"),
            "assigned_doctor_id": updated.get("assigned_doctor_id"),
            "assigned_doctor_name": updated.get("assigned_doctor_name", ""),
            "source": "clinical_safety_workflow",
        }
        if user.get("role") == "doctor":
            create_alert({**alert_payload, "target_role": "hospital_admin"})
        elif updated.get("assigned_doctor_id"):
            create_alert({**alert_payload, "target_role": "doctor", "target_user_id": updated.get("assigned_doctor_id")})

    patient_user_id = updated.get("patient_user_id")
    if patient_user_id and updates["status"] == "completed":
        visit_entry = {
            "appointment_id": updated.get("id") or appointment_id,
            "completed_at": updated.get("completed_at") or utc_now(),
            "appointment_date": updated.get("appointment_date"),
            "appointment_time": updated.get("appointment_time"),
            "doctor_name": updated.get("assigned_doctor_name") or user.get("name"),
            "doctor_specialty": updated.get("assigned_doctor_specialty"),
            "doctor_code": updated.get("assigned_doctor_code"),
            "visit_reason": updated.get("reason") or "",
            "consultation_notes": updated.get("consultation_notes") or "",
            "diagnosis_summary": updated.get("diagnosis_summary") or "",
            "vitals_summary": updated.get("vitals_summary") or "",
            "prescription_summary": updated.get("prescription_summary") or "",
            "scan_summary": updated.get("scan_summary") or "",
            "follow_up_plan": updated.get("follow_up_plan") or "",
            "clinician_updated_by": updated.get("clinician_updated_by") or user.get("name"),
        }
        upsert_visit_history_entry(patient_user_id, visit_entry)
        update_patient_profile(
            patient_user_id,
            {
                "status": "Visit completed",
                "last_summary": updated.get("diagnosis_summary")
                or updated.get("consultation_notes")
                or updated.get("reason")
                or "Visit completed",
            },
        )
    return updated
