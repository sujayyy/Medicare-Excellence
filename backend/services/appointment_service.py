from typing import Any, Optional

from models.alert_model import create_alert
from models.appointment_model import create_appointment_record, get_appointment_by_id, list_appointments, update_appointment_record
from models.base import utc_now
from models.patient_model import get_patient_by_user_id, update_patient_profile, upsert_visit_history_entry
from models.user_model import DEFAULT_HOSPITAL_ID, get_doctor_by_id, list_users_by_role, sanitize_user
from services.doctor_routing_service import get_specialty_label


class ValidationError(ValueError):
    pass


APPOINTMENT_STATUSES = {"requested", "confirmed", "in_consultation", "completed", "cancelled"}


def _hospital_id(user: dict[str, Any]) -> str:
    return user.get("hospital_id") or DEFAULT_HOSPITAL_ID


def list_doctor_directory(user: dict[str, Any], *, specialty: Optional[str] = None) -> list[dict[str, Any]]:
    doctors = list_users_by_role("doctor", hospital_id=_hospital_id(user))
    normalized_specialty = (specialty or "").strip().lower()
    if normalized_specialty:
        doctors = [doctor for doctor in doctors if (doctor.get("specialty") or "").lower() == normalized_specialty]

    directory = []
    for doctor in doctors:
        safe_doctor = sanitize_user(doctor) or {}
        directory.append(
            {
                "id": safe_doctor.get("id"),
                "name": safe_doctor.get("name"),
                "email": safe_doctor.get("email"),
                "specialty": safe_doctor.get("specialty"),
                "specialty_label": get_specialty_label(safe_doctor.get("specialty")),
                "doctor_code": safe_doctor.get("doctor_code"),
                "hospital_id": safe_doctor.get("hospital_id"),
            }
        )
    return directory


def _validate_appointment_payload(payload: dict[str, Any]) -> dict[str, str]:
    doctor_id = (payload.get("doctor_id") or "").strip()
    appointment_date = (payload.get("appointment_date") or "").strip()
    appointment_time = (payload.get("appointment_time") or "").strip()
    reason = " ".join((payload.get("reason") or "").strip().split())
    notes = " ".join((payload.get("notes") or "").strip().split())

    if not doctor_id:
        raise ValidationError("Please choose a doctor.")
    if not appointment_date:
        raise ValidationError("Please choose an appointment date.")
    if not appointment_time:
        raise ValidationError("Please choose an appointment time.")
    if len(reason) < 3:
        raise ValidationError("Please add a short reason for the visit.")

    return {
        "doctor_id": doctor_id,
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
        }
    )


def get_appointment_records(user: dict[str, Any]) -> list[dict[str, Any]]:
    role = user.get("role")
    if role == "patient":
        return list_appointments(patient_user_id=str(user["_id"]))
    if role == "doctor":
        return list_appointments(hospital_id=_hospital_id(user), assigned_doctor_id=str(user["_id"]))
    return list_appointments(hospital_id=_hospital_id(user))


def update_clinician_appointment(appointment_id: str, payload: dict[str, Any], user: dict[str, Any]) -> dict[str, Any]:
    appointment = get_appointment_by_id(appointment_id)
    if not appointment:
        raise ValidationError("Appointment not found.")

    if user.get("role") == "doctor" and appointment.get("assigned_doctor_id") != str(user["_id"]):
        raise ValidationError("You can only update your own appointments.")
    if user.get("role") not in {"doctor", "hospital_admin"}:
        raise ValidationError("Only clinicians can update appointments.")

    status = (payload.get("status") or appointment.get("status") or "").strip().lower()
    if status and status not in APPOINTMENT_STATUSES:
        raise ValidationError("Appointment status is invalid.")

    updates = {
        "status": status or appointment.get("status") or "requested",
        "consultation_notes": " ".join((payload.get("consultation_notes") or appointment.get("consultation_notes") or "").split()),
        "diagnosis_summary": " ".join((payload.get("diagnosis_summary") or appointment.get("diagnosis_summary") or "").split()),
        "vitals_summary": " ".join((payload.get("vitals_summary") or appointment.get("vitals_summary") or "").split()),
        "prescription_summary": " ".join((payload.get("prescription_summary") or appointment.get("prescription_summary") or "").split()),
        "scan_summary": " ".join((payload.get("scan_summary") or appointment.get("scan_summary") or "").split()),
        "follow_up_plan": " ".join((payload.get("follow_up_plan") or appointment.get("follow_up_plan") or "").split()),
        "clinician_updated_by": user.get("name"),
        "clinician_updated_by_user_id": str(user["_id"]),
    }

    if updates["status"] == "in_consultation" and not appointment.get("consultation_started_at"):
        updates["consultation_started_at"] = utc_now()
    if updates["status"] == "completed":
        updates["completed_at"] = utc_now()

    updated = update_appointment_record(appointment_id, updates)
    if not updated:
        raise ValidationError("Unable to update the appointment.")

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
