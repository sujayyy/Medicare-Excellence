import re
from typing import Any, Optional

from flask import current_app, g

from models.base import serialize_document, utc_now
from models.alert_model import create_alert
from models.chat_model import append_chat_messages, get_chat_by_user_id, serialize_chat_history
from models.emergency_model import create_emergency_log
from models.patient_model import (
    create_guest_patient_from_message,
    get_patient_by_user_id,
    update_patient_profile,
)
from models.user_model import DEFAULT_HOSPITAL_ID, get_doctor_for_specialty, sanitize_user
from services.ai_service import get_ai_response
from services.appointment_service import create_chat_appointment_request, list_doctor_directory
from services.doctor_routing_service import get_specialty_label, infer_specialty
from services.appointment_risk_service import build_appointment_risk_profile
from services.deterioration_service import build_deterioration_insights
from services.deterioration_prediction_service import build_deterioration_prediction, enrich_deterioration_prediction
from services.follow_up_service import generate_follow_up_questions
from services.follow_up_service import get_follow_up_intro
from services.summary_service import build_patient_summary
from services.symptom_extraction_service import extract_symptom_entities
from services.triage_service import assess_triage


class ValidationError(ValueError):
    pass


APPOINTMENT_KEYWORDS = ("appointment", "book", "schedule", "consultation")
EMERGENCY_KEYWORDS = ("emergency", "help", "ambulance", "urgent", "severe", "chest pain")
HIGH_RISK_TRIAGE_LABELS = {"High", "Critical"}
APPOINTMENT_STAGES = ("name", "age", "phone", "preferred_slot", "reason", "doctor_choice")
APPOINTMENT_CANCEL_KEYWORDS = {"cancel", "stop", "exit", "leave booking", "skip booking"}
NAME_BLOCKED_TERMS = {
    "appointment",
    "book",
    "schedule",
    "tomorrow",
    "today",
    "fever",
    "pain",
    "headache",
    "cough",
    "doctor",
    "hospital",
}
SLOT_HINT_WORDS = {
    "today",
    "tomorrow",
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
    "sunday",
    "morning",
    "afternoon",
    "evening",
    "night",
    "am",
    "pm",
    "next",
    "after",
    "before",
}


def _clean_text(value: str) -> str:
    return " ".join((value or "").strip().split())


def _get_patient_snapshot(user: Optional[dict[str, Any]]) -> Optional[dict[str, Any]]:
    if not user or user.get("role") != "patient":
        return None
    return _safe_execute("load patient snapshot", lambda: get_patient_by_user_id(str(user["_id"])), default=None)


def _build_ai_patient_context(patient: Optional[dict[str, Any]]) -> dict[str, Any]:
    if not patient:
        return {}

    visit_history = list(patient.get("visit_history") or [])[:3]
    return {
        "age": patient.get("age"),
        "gender": patient.get("gender"),
        "dob": patient.get("dob"),
        "assigned_doctor_name": patient.get("assigned_doctor_name"),
        "assigned_doctor_specialty": patient.get("assigned_doctor_specialty"),
        "visit_history": visit_history,
    }


def _appointment_stage_prompt(stage: str, *, patient_name: str = "") -> str:
    if stage == "name":
        return (
            "I can help with that.\n\n"
            "**Appointment booking**\n"
            "- Step 1 of 5\n"
            "- Please share your full name.\n"
            "- You can type `cancel` anytime to stop booking."
        )
    if stage == "age":
        return (
            "**Appointment booking**\n"
            "- Step 2 of 5\n"
            f"- Thanks{f', {patient_name}' if patient_name else ''}. What is the patient's age?"
        )
    if stage == "phone":
        return (
            "**Appointment booking**\n"
            "- Step 3 of 5\n"
            "- What contact number should the hospital use?"
        )
    if stage == "preferred_slot":
        return (
            "**Appointment booking**\n"
            "- Step 4 of 5\n"
            "- What day or time would you prefer? Example: Tomorrow morning or Friday after 4 PM."
        )
    if stage == "reason":
        return (
            "**Appointment booking**\n"
            "- Step 5 of 6\n"
            "- What is the main reason for the visit? Example: chest pain, fever, follow-up, prescription review."
        )
    return (
        "**Appointment booking**\n"
        "- Step 6 of 6\n"
        "- Please choose one of the suggested doctors by number or by typing the doctor's name."
    )


def _appointment_error_prompt(stage: str) -> str:
    if stage == "name":
        return "Please send only the patient's full name so I can continue the appointment request. You can also type `cancel`."
    if stage == "age":
        return "Please send the age as a number, for example: 32. You can also type `cancel`."
    if stage == "phone":
        return "Please send a valid contact number so the hospital can reach you. You can also type `cancel`."
    if stage == "preferred_slot":
        return "Please tell me the preferred day or time clearly, for example: tomorrow morning or Friday after 4 PM. You can also type `cancel`."
    if stage == "reason":
        return "Please tell me the main reason for the appointment in one short line, for example: fever, headache, chest pain, or follow-up. You can also type `cancel`."
    return "Please choose one of the listed doctors by number or by name. You can also type `cancel`."


def _looks_like_valid_name(candidate: str) -> bool:
    trimmed = _clean_text(candidate)
    if not re.fullmatch(r"[A-Za-z][A-Za-z .'-]{1,59}", trimmed):
        return False

    words = trimmed.lower().split()
    if len(words) > 4:
        return False
    if any(word in NAME_BLOCKED_TERMS for word in words):
        return False
    return True


def _looks_like_slot(candidate: str) -> bool:
    lowered = candidate.lower()
    if any(word in lowered for word in SLOT_HINT_WORDS):
        return True

    if re.search(r"\b\d{1,2}(:\d{2})?\s*(am|pm)\b", lowered):
        return True

    if re.search(r"\b\d{1,2}\s*(am|pm)\b", lowered):
        return True

    if len(candidate.split()) >= 2 and len(candidate) >= 8:
        return True

    return False


def _is_cancel_message(user_message: str) -> bool:
    normalized = _clean_text(user_message).lower()
    return normalized in APPOINTMENT_CANCEL_KEYWORDS


def _format_doctor_choice_prompt(doctors: list[dict[str, Any]], specialty: str) -> str:
    specialty_label = get_specialty_label(specialty)
    lines = [
        "**Appointment booking**",
        "- Step 6 of 6",
        f"- I found these {specialty_label} doctors for your concern:",
    ]
    for index, doctor in enumerate(doctors[:5], start=1):
        lines.append(f"{index}. {doctor['name']} ({doctor['doctor_code']})")
    lines.append("")
    lines.append("Reply with the number or doctor name you want to book.")
    return "\n".join(lines)


def _pick_doctor_from_choice(user_message: str, doctors: list[dict[str, Any]]) -> Optional[dict[str, Any]]:
    normalized = _clean_text(user_message)
    if not normalized:
        return None

    if normalized.isdigit():
        index = int(normalized) - 1
        if 0 <= index < len(doctors):
            return doctors[index]

    lowered = normalized.lower()
    for doctor in doctors:
        if lowered == doctor["name"].lower():
            return doctor
        if doctor.get("doctor_code") and lowered == str(doctor["doctor_code"]).lower():
            return doctor
        if lowered in doctor["name"].lower():
            return doctor
    return None


def _extract_appointment_stage_value(stage: str, user_message: str) -> Optional[str]:
    normalized = _clean_text(user_message)
    if not normalized:
        return None

    if stage == "name":
        match = re.search(r"(?:my name is|name is)\s+([a-zA-Z ]{2,60})", normalized, re.IGNORECASE)
        candidate = match.group(1).strip() if match else normalized
        if _looks_like_valid_name(candidate):
            return candidate
        return None

    if stage == "age":
        match = re.search(r"\b(\d{1,3})\b", normalized)
        if not match:
            return None
        age_value = int(match.group(1))
        return str(age_value) if 0 < age_value < 121 else None

    if stage == "phone":
        digits = re.sub(r"\D", "", normalized)
        return normalized if len(digits) >= 7 else None

    if stage == "preferred_slot":
        return normalized if _looks_like_slot(normalized) else None

    if stage == "reason":
        if len(normalized) < 3:
            return None
        if normalized.lower() in {"appointment", "book appointment", "consultation"}:
            return None
        return normalized

    return normalized


def _next_appointment_stage(current_stage: str) -> Optional[str]:
    try:
        current_index = APPOINTMENT_STAGES.index(current_stage)
    except ValueError:
        return APPOINTMENT_STAGES[0]
    return APPOINTMENT_STAGES[current_index + 1] if current_index + 1 < len(APPOINTMENT_STAGES) else None


def _format_numbered_questions(questions: list[str]) -> str:
    return "\n".join(f"{index + 1}. {question}" for index, question in enumerate(questions))


def _append_questions(base_response: str, questions: list[str], *, emergency: bool = False) -> str:
    if not questions:
        return base_response
    return f"{base_response}\n\n**{get_follow_up_intro(emergency=emergency)}**\n{_format_numbered_questions(questions)}"


def _extract_patient_details(user_message: str) -> dict[str, Any]:
    normalized = " ".join(user_message.split())
    name_match = re.search(r"my name is\s+([a-zA-Z ]+?)(?:,| and| age| contact| phone|$)", normalized, re.IGNORECASE)
    age_match = re.search(r"(?:age is|i am)\s+(\d{1,3})", normalized, re.IGNORECASE)
    phone_match = re.search(
        r"(?:contact(?: number)?|phone(?: number)?|mobile(?: number)?)(?: is|:)?\s*([\d+\-\s]{7,})",
        normalized,
        re.IGNORECASE,
    )

    details = {
        "name": name_match.group(1).strip() if name_match else None,
        "age": int(age_match.group(1)) if age_match else None,
        "phone": phone_match.group(1).strip() if phone_match else "",
        "raw_text": user_message,
    }

    if details["name"] and details["age"] and details["phone"]:
        return details

    compact_parts = [part.strip() for part in re.split(r"[,\n;|]+", normalized) if part.strip()]
    if len(compact_parts) >= 3:
        compact_name = compact_parts[0]
        compact_age = compact_parts[1]
        compact_phone = compact_parts[2]

        if not details["name"] and re.fullmatch(r"[A-Za-z ]{2,40}", compact_name):
            details["name"] = compact_name
        if not details["age"] and compact_age.isdigit():
            age_value = int(compact_age)
            if 0 < age_value < 121:
                details["age"] = age_value
        if not details["phone"]:
            phone_digits = re.sub(r"\D", "", compact_phone)
            if len(phone_digits) >= 7:
                details["phone"] = compact_phone

    # Support simple space-separated intake like "jen 14 38837888935"
    if not (details["name"] and details["age"] and details["phone"]):
        tokens = normalized.split()
        if len(tokens) >= 3:
            possible_phone = tokens[-1]
            possible_age = tokens[-2]
            possible_name = " ".join(tokens[:-2]).strip()
            phone_digits = re.sub(r"\D", "", possible_phone)

            if not details["name"] and re.fullmatch(r"[A-Za-z ]{2,40}", possible_name):
                details["name"] = possible_name
            if not details["age"] and possible_age.isdigit():
                age_value = int(possible_age)
                if 0 < age_value < 121:
                    details["age"] = age_value
            if not details["phone"] and len(phone_digits) >= 7:
                details["phone"] = possible_phone

    return details


def _is_appointment_message(user_message: str) -> bool:
    lowered = user_message.lower()
    return any(keyword in lowered for keyword in APPOINTMENT_KEYWORDS)


def _is_emergency_message(user_message: str) -> bool:
    lowered = user_message.lower()
    return any(keyword in lowered for keyword in EMERGENCY_KEYWORDS)


def _appointment_intake_pending(user: Optional[dict[str, Any]]) -> bool:
    if not user or user.get("role") != "patient":
        return False

    patient = _get_patient_snapshot(user)
    return bool(patient and patient.get("appointment_intake_pending"))


def _safe_execute(action: str, callback, *, default=None):
    try:
        return callback()
    except Exception as exc:  # pragma: no cover - defensive runtime fallback
        current_app.logger.exception("Chat workflow step failed during %s: %s", action, exc)
        return default


def _safe_perform(action: str, callback) -> bool:
    try:
        callback()
        return True
    except Exception as exc:  # pragma: no cover - defensive runtime fallback
        current_app.logger.exception("Chat workflow step failed during %s: %s", action, exc)
        return False


def _hospital_id_for_user(user: Optional[dict[str, Any]]) -> str:
    if user and user.get("hospital_id"):
        return user["hospital_id"]
    return DEFAULT_HOSPITAL_ID


def _resolve_care_assignment(
    user: Optional[dict[str, Any]],
    *,
    user_message: str = "",
    entities: Optional[dict[str, Any]] = None,
) -> tuple[str, Optional[str], str, str]:
    hospital_id = _hospital_id_for_user(user)
    if not user or user.get("role") != "patient":
        return hospital_id, None, "", "general_medicine"

    patient = _safe_execute("load patient assignment", lambda: get_patient_by_user_id(str(user["_id"])), default=None) or {}
    requested_specialty = infer_specialty(user_message=user_message, entities=entities)
    assigned_doctor_id = patient.get("assigned_doctor_id")
    assigned_doctor_name = patient.get("assigned_doctor_name", "")
    assigned_doctor_specialty = patient.get("assigned_doctor_specialty") or "general_medicine"
    if assigned_doctor_id and assigned_doctor_specialty == requested_specialty:
        return hospital_id, assigned_doctor_id, assigned_doctor_name, assigned_doctor_specialty

    doctor = _safe_execute(
        "find specialty doctor",
        lambda: get_doctor_for_specialty(hospital_id, requested_specialty),
        default=None,
    )
    if not doctor:
        if assigned_doctor_id:
            return hospital_id, assigned_doctor_id, assigned_doctor_name, assigned_doctor_specialty
        return hospital_id, None, "", requested_specialty

    assigned_doctor_id = str(doctor["_id"])
    assigned_doctor_name = doctor.get("name", "")
    assigned_doctor_specialty = doctor.get("specialty") or requested_specialty
    _safe_execute(
        "persist doctor assignment",
        lambda: update_patient_profile(
            str(user["_id"]),
            {
                "hospital_id": hospital_id,
                "assigned_doctor_id": assigned_doctor_id,
                "assigned_doctor_name": assigned_doctor_name,
                "assigned_doctor_specialty": assigned_doctor_specialty,
            },
        ),
    )
    return hospital_id, assigned_doctor_id, assigned_doctor_name, assigned_doctor_specialty


def _create_care_alerts(
    *,
    alert_type: str,
    title: str,
    message: str,
    user: Optional[dict[str, Any]],
    severity: str,
    hospital_id: str,
    assigned_doctor_id: Optional[str] = None,
    assigned_doctor_name: str = "",
    triage: Optional[dict[str, Any]] = None,
) -> None:
    patient_name = user.get("name") if user else "Guest Patient"
    patient_email = user.get("email") if user else ""
    patient_user_id = str(user["_id"]) if user else None
    base_payload = {
        "type": alert_type,
        "title": title,
        "message": message,
        "hospital_id": hospital_id,
        "severity": severity,
        "patient_user_id": patient_user_id,
        "patient_name": patient_name,
        "patient_email": patient_email,
        "assigned_doctor_id": assigned_doctor_id,
        "assigned_doctor_name": assigned_doctor_name,
        "source": "chat",
    }

    if triage:
        base_payload["triage_label"] = triage.get("triage_label")
        base_payload["triage_score"] = triage.get("triage_score")
        base_payload["recommended_action"] = triage.get("recommended_action")

    _safe_execute("create hospital admin alert", lambda: create_alert({**base_payload, "target_role": "hospital_admin"}))
    if assigned_doctor_id:
        _safe_execute(
            "create doctor alert",
            lambda: create_alert(
                {
                    **base_payload,
                    "target_role": "doctor",
                    "target_user_id": assigned_doctor_id,
                }
            ),
        )


def _save_chat_if_possible(
    user: Optional[dict[str, Any]],
    user_message: str,
    assistant_message: str,
    *,
    triage: Optional[dict[str, Any]] = None,
    entities: Optional[dict[str, Any]] = None,
) -> None:
    if not user:
        return

    safe_user = sanitize_user(user)
    _safe_execute(
        "save chat history",
        lambda: append_chat_messages(
            safe_user,
            [
                {"role": "user", "content": user_message},
                {"role": "assistant", "content": assistant_message},
            ],
            triage=triage,
            entities=entities,
        ),
    )


def _triage_patient_payload(triage: dict[str, Any]) -> dict[str, Any]:
    return {
        "risk_level": triage["triage_label"],
        "triage_score": triage["triage_score"],
        "triage_label": triage["triage_label"],
        "triage_reason": triage["triage_reason"],
        "recommended_action": triage["recommended_action"],
        "triage_updated_at": utc_now(),
    }


def _entity_patient_payload(entities: dict[str, Any]) -> dict[str, Any]:
    return {
        "symptoms": entities.get("symptoms", []),
        "duration_text": entities.get("duration_text", ""),
        "body_parts": entities.get("body_parts", []),
        "medications_mentioned": entities.get("medications_mentioned", []),
        "red_flags": entities.get("red_flags", []),
        "extracted_entities_updated_at": utc_now(),
    }


def _summary_patient_payload(
    *,
    patient_name: str,
    user_message: str,
    triage: dict[str, Any],
    entities: dict[str, Any],
    current_status: str,
) -> dict[str, Any]:
    summary = build_patient_summary(
        patient_name=patient_name,
        user_message=user_message,
        triage=triage,
        entities=entities,
        current_status=current_status,
    )
    return {
        **summary,
        "summary_updated_at": utc_now(),
    }


def _follow_up_patient_payload(questions: list[str]) -> dict[str, Any]:
    return {
        "follow_up_questions": questions,
        "follow_up_updated_at": utc_now(),
    }


def _deterioration_patient_payload(
    previous_patient: Optional[dict[str, Any]],
    triage: dict[str, Any],
    entities: dict[str, Any],
) -> dict[str, Any]:
    return build_deterioration_insights(
        previous_patient=previous_patient,
        triage=triage,
        entities=entities,
    )


def _appointment_risk_patient_payload(
    *,
    previous_patient: Optional[dict[str, Any]],
    triage: dict[str, Any],
    entities: dict[str, Any],
    current_status: str,
    deterioration: Optional[dict[str, Any]] = None,
) -> dict[str, Any]:
    return build_appointment_risk_profile(
        previous_patient=previous_patient,
        triage=triage,
        entities=entities,
        current_status=current_status,
        deterioration=deterioration,
    )


def _deterioration_prediction_patient_payload(
    *,
    previous_patient: Optional[dict[str, Any]],
    triage: dict[str, Any],
    entities: dict[str, Any],
    current_status: str,
    deterioration: Optional[dict[str, Any]] = None,
    appointment_risk: Optional[dict[str, Any]] = None,
) -> dict[str, Any]:
    return build_deterioration_prediction(
        previous_patient=previous_patient,
        triage=triage,
        entities=entities,
        current_status=current_status,
        deterioration=deterioration,
        appointment_risk=appointment_risk,
    )


def _finalize_appointment_request(
    *,
    user_message: str,
    user: Optional[dict[str, Any]],
    details: dict[str, Any],
    previous_patient: Optional[dict[str, Any]] = None,
) -> str:
    triage_message = details.get("reason") or details.get("initial_request") or user_message
    triage = assess_triage(triage_message, appointment=True)
    entities = extract_symptom_entities(triage_message)
    selected_doctor = details.get("selected_doctor") or {}
    if selected_doctor:
        hospital_id = _hospital_id_for_user(user)
        assigned_doctor_id = selected_doctor.get("id")
        assigned_doctor_name = selected_doctor.get("name", "")
        assigned_doctor_specialty = selected_doctor.get("specialty", "general_medicine")
        selected_doctor_code = selected_doctor.get("doctor_code", "")
    else:
        hospital_id, assigned_doctor_id, assigned_doctor_name, assigned_doctor_specialty = _resolve_care_assignment(
            user,
            user_message=triage_message,
            entities=entities,
        )
        selected_doctor_code = ""

    requested_deterioration = _deterioration_patient_payload(previous_patient, triage, entities)
    requested_appointment_risk = _appointment_risk_patient_payload(
        previous_patient=previous_patient,
        triage=triage,
        entities=entities,
        current_status="Appointment requested",
        deterioration=requested_deterioration,
    )
    requested_prediction = _deterioration_prediction_patient_payload(
        previous_patient=previous_patient,
        triage=triage,
        entities=entities,
        current_status="Appointment requested",
        deterioration=requested_deterioration,
        appointment_risk=requested_appointment_risk,
    )

    persisted = True
    if user and user["role"] == "patient":
        existing_phone = details.get("phone") or (previous_patient or {}).get("phone") or ""
        existing_age = int(details["age"]) if details.get("age") else (previous_patient or {}).get("age")
        persisted = _safe_perform(
            "record patient appointment request",
            lambda: update_patient_profile(
                str(user["_id"]),
                {
                    "name": details.get("name") or user["name"],
                    "email": user["email"],
                    "hospital_id": hospital_id,
                    "phone": existing_phone,
                    "age": existing_age,
                    "dob": (previous_patient or {}).get("dob", ""),
                    "gender": (previous_patient or {}).get("gender", ""),
                    "status": "Appointment requested",
                    "appointment_intake_pending": False,
                    "appointment_intake_stage": "",
                    "appointment_intake_data": {},
                    "preferred_appointment_slot": details.get("preferred_slot", ""),
                    "appointment_reason": details.get("reason", ""),
                    "assigned_doctor_code": selected_doctor_code,
                    "assigned_doctor_id": assigned_doctor_id,
                    "assigned_doctor_name": assigned_doctor_name,
                    "assigned_doctor_specialty": assigned_doctor_specialty,
                    "last_summary": triage_message,
                    **requested_deterioration,
                    **requested_appointment_risk,
                    **requested_prediction,
                    **_follow_up_patient_payload([]),
                    **_summary_patient_payload(
                        patient_name=details.get("name") or user["name"],
                        user_message=triage_message,
                        triage=triage,
                        entities=entities,
                        current_status="Appointment requested",
                    ),
                    **_triage_patient_payload(triage),
                    **_entity_patient_payload(entities),
                },
                increment={"appointments_requested": 1},
            ),
        )
        _safe_execute(
            "create appointment record from chat",
            lambda: create_chat_appointment_request(
                user=user,
                details=details,
                hospital_id=hospital_id,
                doctor={
                    "_id": assigned_doctor_id,
                    "name": assigned_doctor_name,
                    "specialty": assigned_doctor_specialty,
                    "doctor_code": selected_doctor_code,
                } if assigned_doctor_id else None,
            ),
        )
    else:
        persisted = _safe_perform(
            "record guest appointment request",
            lambda: create_guest_patient_from_message(
                {
                    **details,
                    "hospital_id": hospital_id,
                    "assigned_doctor_id": assigned_doctor_id,
                    "assigned_doctor_name": assigned_doctor_name,
                    "assigned_doctor_specialty": assigned_doctor_specialty,
                    **requested_appointment_risk,
                    **requested_prediction,
                }
            ),
        )

    if not persisted:
        return "I captured the appointment details, but the booking system is temporarily unavailable. Please try again shortly."

    _create_care_alerts(
        alert_type="appointment_request",
        title="New appointment request",
        message=f"{details.get('name') or (user['name'] if user else 'A patient')} submitted appointment intake details.",
        user=user,
        severity="medium",
        hospital_id=hospital_id,
        assigned_doctor_id=assigned_doctor_id,
        assigned_doctor_name=assigned_doctor_name,
        triage=triage,
    )

    preferred_slot = details.get("preferred_slot") or "next available slot"
    visit_reason = details.get("reason") or "general consultation"
    specialty_line = assigned_doctor_specialty.replace("_", " ").title() if assigned_doctor_specialty else "General Medicine"
    doctor_line = assigned_doctor_name or "Hospital care team"

    return (
        "**Appointment request submitted**\n"
        f"- Name: {details.get('name') or (user['name'] if user else 'Patient')}\n"
        f"- Contact: {details.get('phone', 'Not provided')}\n"
        f"- Preferred slot: {preferred_slot}\n"
        f"- Visit reason: {visit_reason}\n"
        f"- Doctor: {doctor_line}{f' ({selected_doctor_code})' if selected_doctor_code else ''}\n"
        f"- Specialty: {specialty_line}\n\n"
        "**What happens next**\n"
        "- The care team will review the request and contact you shortly.\n"
        "- If your symptoms worsen before the appointment, message here again or seek urgent care."
    )


def _start_appointment_intake(user_message: str, user: Optional[dict[str, Any]]) -> str:
    previous_patient = _get_patient_snapshot(user)
    triage = assess_triage(user_message, appointment=True)
    entities = extract_symptom_entities(user_message)
    compact_details = _extract_patient_details(user_message)
    if compact_details.get("name") and compact_details.get("age") and compact_details.get("phone"):
        compact_details["initial_request"] = user_message
        return _finalize_appointment_request(
            user_message=user_message,
            user=user,
            details=compact_details,
            previous_patient=previous_patient,
        )

    hospital_id, assigned_doctor_id, assigned_doctor_name, assigned_doctor_specialty = _resolve_care_assignment(
        user,
        user_message=user_message,
        entities=entities,
    )

    if user and user["role"] == "patient":
        prefilled_name = (previous_patient or {}).get("name") or user["name"]
        prefilled_age = (previous_patient or {}).get("age")
        prefilled_phone = (previous_patient or {}).get("phone", "")
        initial_stage = "name"
        initial_data: dict[str, Any] = {"initial_request": user_message}
        if prefilled_name and prefilled_age and prefilled_phone:
            initial_stage = "preferred_slot"
            initial_data.update(
                {
                    "name": prefilled_name,
                    "age": str(prefilled_age),
                    "phone": prefilled_phone,
                }
            )

        pending_deterioration = _deterioration_patient_payload(previous_patient, triage, entities)
        pending_appointment_risk = _appointment_risk_patient_payload(
            previous_patient=previous_patient,
            triage=triage,
            entities=entities,
            current_status="Appointment intake pending",
            deterioration=pending_deterioration,
        )
        pending_prediction = _deterioration_prediction_patient_payload(
            previous_patient=previous_patient,
            triage=triage,
            entities=entities,
            current_status="Appointment intake pending",
            deterioration=pending_deterioration,
            appointment_risk=pending_appointment_risk,
        )
        _safe_execute(
            "mark appointment intake pending",
            lambda: update_patient_profile(
                str(user["_id"]),
                {
                    "name": user["name"],
                    "email": user["email"],
                    "hospital_id": hospital_id,
                    "status": "Appointment intake pending",
                    "appointment_intake_pending": True,
                    "appointment_intake_stage": initial_stage,
                    "appointment_intake_data": initial_data,
                    "assigned_doctor_id": assigned_doctor_id,
                    "assigned_doctor_name": assigned_doctor_name,
                    "assigned_doctor_specialty": assigned_doctor_specialty,
                    "last_summary": user_message,
                    **pending_deterioration,
                    **pending_appointment_risk,
                    **pending_prediction,
                    **_follow_up_patient_payload([]),
                    **_summary_patient_payload(
                        patient_name=user["name"],
                        user_message=user_message,
                        triage=triage,
                        entities=entities,
                        current_status="Appointment intake pending",
                    ),
                    **_triage_patient_payload(triage),
                    **_entity_patient_payload(entities),
                },
            ),
        )

    if user and user.get("role") == "patient" and previous_patient and previous_patient.get("age") and previous_patient.get("phone"):
        return (
            "**Appointment booking**\n"
            "- I already have your profile details saved.\n"
            "- Let's use those and move to scheduling.\n\n"
            f"{_appointment_stage_prompt('preferred_slot', patient_name=previous_patient.get('name', user['name']))}"
        )

    return _appointment_stage_prompt("name")


def _continue_appointment_intake(user_message: str, user: Optional[dict[str, Any]]) -> Optional[str]:
    if not user or user.get("role") != "patient":
        return None

    patient = _get_patient_snapshot(user) or {}
    if not patient.get("appointment_intake_pending"):
        return None

    if _is_cancel_message(user_message):
        _safe_execute(
            "cancel appointment intake",
            lambda: update_patient_profile(
                str(user["_id"]),
                {
                    "appointment_intake_pending": False,
                    "appointment_intake_stage": "",
                    "appointment_intake_data": {},
                    "status": "Monitoring",
                },
            ),
        )
        return (
            "**Appointment booking cancelled**\n"
            "- I cleared the pending booking steps.\n"
            "- You can start again anytime by saying you want to book an appointment."
        )

    stage = patient.get("appointment_intake_stage") or "name"
    data = dict(patient.get("appointment_intake_data") or {})
    previous_patient = patient

    compact_details = _extract_patient_details(user_message)
    if stage in {"name", "age", "phone"} and compact_details.get("name") and compact_details.get("age") and compact_details.get("phone"):
        data.update(
            {
                "name": compact_details.get("name"),
                "age": str(compact_details.get("age")),
                "phone": compact_details.get("phone"),
            }
        )
        next_stage = "preferred_slot"
        _safe_execute(
            "advance appointment intake from compact details",
            lambda: update_patient_profile(
                str(user["_id"]),
                {
                    "appointment_intake_pending": True,
                    "appointment_intake_stage": next_stage,
                    "appointment_intake_data": data,
                    "status": "Appointment intake pending",
                },
            ),
        )
        return _appointment_stage_prompt(next_stage, patient_name=data.get("name", ""))

    value = _extract_appointment_stage_value(stage, user_message)
    if not value:
        return _appointment_error_prompt(stage)

    data[stage] = value

    if stage == "reason":
        specialty = infer_specialty(
            user_message=f"{data.get('initial_request', '')} {value}".strip(),
            entities=extract_symptom_entities(value),
        )
        doctor_options = list_doctor_directory(user or {}, specialty=specialty)
        if not doctor_options:
            doctor_options = list_doctor_directory(user or {})
        if doctor_options:
            data["requested_specialty"] = specialty
            data["doctor_options"] = doctor_options[:5]
            next_stage = "doctor_choice"
            _safe_execute(
                "advance appointment intake to doctor choice",
                lambda: update_patient_profile(
                    str(user["_id"]),
                    {
                        "appointment_intake_pending": True,
                        "appointment_intake_stage": next_stage,
                        "appointment_intake_data": data,
                        "status": "Appointment intake pending",
                    },
                ),
            )
            return _format_doctor_choice_prompt(data["doctor_options"], specialty)
        return (
            "**Appointment booking paused**\n"
            "- No doctor profiles are available in the current hospital setup yet.\n"
            "- Please ask the hospital admin to add doctors, then try booking again."
        )

    next_stage = _next_appointment_stage(stage)
    if next_stage:
        _safe_execute(
            "advance appointment intake stage",
            lambda: update_patient_profile(
                str(user["_id"]),
                {
                    "appointment_intake_pending": True,
                    "appointment_intake_stage": next_stage,
                    "appointment_intake_data": data,
                    "status": "Appointment intake pending",
                },
            ),
        )
        return _appointment_stage_prompt(next_stage, patient_name=data.get("name", ""))

    if stage == "doctor_choice":
        doctor_options = data.get("doctor_options") or []
        selected_doctor = _pick_doctor_from_choice(user_message, doctor_options)
        if not selected_doctor:
            return _appointment_error_prompt("doctor_choice")
        data["selected_doctor"] = selected_doctor

    details = {
        "name": data.get("name") or user.get("name"),
        "age": data.get("age"),
        "phone": data.get("phone", ""),
        "preferred_slot": data.get("preferred_slot", ""),
        "reason": data.get("reason", ""),
        "initial_request": data.get("initial_request", ""),
        "selected_doctor": data.get("selected_doctor"),
    }
    return _finalize_appointment_request(
        user_message=user_message,
        user=user,
        details=details,
        previous_patient=previous_patient,
    )


def _record_emergency(user_message: str, user: Optional[dict[str, Any]]) -> str:
    triage = assess_triage(user_message, emergency=True)
    entities = extract_symptom_entities(user_message)
    follow_up_questions = generate_follow_up_questions(entities=entities, triage=triage, emergency=True)
    hospital_id, assigned_doctor_id, assigned_doctor_name, assigned_doctor_specialty = _resolve_care_assignment(
        user,
        user_message=user_message,
        entities=entities,
    )
    previous_patient = _safe_execute("load patient snapshot", lambda: get_patient_by_user_id(str(user["_id"])), default=None) if user and user.get("role") == "patient" else None
    deterioration = _deterioration_patient_payload(previous_patient, triage, entities)
    appointment_risk = _appointment_risk_patient_payload(
        previous_patient=previous_patient,
        triage=triage,
        entities=entities,
        current_status="Emergency reported",
        deterioration=deterioration,
    )
    prediction = _deterioration_prediction_patient_payload(
        previous_patient=previous_patient,
        triage=triage,
        entities=entities,
        current_status="Emergency reported",
        deterioration=deterioration,
        appointment_risk=appointment_risk,
    )
    emergency_log = _safe_execute(
        "create emergency log",
        lambda: create_emergency_log(
            {
                "user_id": str(user["_id"]) if user else None,
                "patient_name": user["name"] if user else "Unknown",
                "email": user["email"] if user else "",
                "message": user_message,
                "severity": "High",
                "hospital_id": hospital_id,
                "assigned_doctor_id": assigned_doctor_id,
                "assigned_doctor_name": assigned_doctor_name,
            }
        ),
        default=None,
    )

    if user and user["role"] == "patient":
        _safe_execute(
            "update patient emergency status",
            lambda: update_patient_profile(
                str(user["_id"]),
                {
                    "name": user["name"],
                    "email": user["email"],
                    "hospital_id": hospital_id,
                    "status": "Emergency reported",
                    "assigned_doctor_id": assigned_doctor_id,
                    "assigned_doctor_name": assigned_doctor_name,
                    "assigned_doctor_specialty": assigned_doctor_specialty,
                    "last_summary": user_message,
                    **deterioration,
                    **appointment_risk,
                    **prediction,
                    **_follow_up_patient_payload(follow_up_questions),
                    **_summary_patient_payload(
                        patient_name=user["name"],
                        user_message=user_message,
                        triage=triage,
                        entities=entities,
                        current_status="Emergency reported",
                    ),
                    **_triage_patient_payload(triage),
                    **_entity_patient_payload(entities),
                },
                increment={"emergency_count": 1},
            ),
        )

    _create_care_alerts(
        alert_type="emergency",
        title="Emergency escalation",
        message=f"{user['name'] if user else 'A patient'} reported potentially urgent symptoms.",
        user=user,
        severity="high",
        hospital_id=hospital_id,
        assigned_doctor_id=assigned_doctor_id,
        assigned_doctor_name=assigned_doctor_name,
        triage=triage,
    )

    if emergency_log:
        response = (
            "**Urgent next step**\n"
            f"- Emergency alert recorded with reference {str(emergency_log['_id'])[-6:].upper()}.\n"
            "- Please contact local emergency services or the hospital immediately.\n\n"
            "**Why this is urgent**\n"
            f"- Current AI triage: {triage.get('triage_label', 'High')} ({triage.get('triage_score', 0)}/100)\n"
            f"- Recommended action: {triage.get('recommended_action', 'Seek urgent in-person care.')}"
        )
        return _append_questions(response, follow_up_questions, emergency=True)

    response = (
        "**Urgent next step**\n"
        "- Your symptoms may require urgent in-person care.\n"
        "- Please contact local emergency services or the hospital immediately."
    )
    return _append_questions(response, follow_up_questions, emergency=True)


def process_chat_message(payload: dict[str, Any], *, user: Optional[dict[str, Any]] = None) -> str:
    user_message = (payload.get("message") or "").strip()
    language_preference = (payload.get("language_preference") or "").strip() or None
    if not user_message:
        raise ValidationError("No message provided.")

    if _is_emergency_message(user_message):
        entities = extract_symptom_entities(user_message)
        response = _record_emergency(user_message, user)
        _save_chat_if_possible(
            user,
            user_message,
            response,
            triage=assess_triage(user_message, emergency=True),
            entities=entities,
        )
        return response

    pending_appointment_response = _continue_appointment_intake(user_message, user)
    if pending_appointment_response is not None:
        entities = extract_symptom_entities(user_message)
        _save_chat_if_possible(
            user,
            user_message,
            pending_appointment_response,
            triage=assess_triage(user_message, appointment=True),
            entities=entities,
        )
        return pending_appointment_response

    if _is_appointment_message(user_message):
        entities = extract_symptom_entities(user_message)
        response = _start_appointment_intake(user_message, user)
        _save_chat_if_possible(
            user,
            user_message,
            response,
            triage=assess_triage(user_message, appointment=True),
            entities=entities,
        )
        return response

    triage = assess_triage(user_message)
    entities = extract_symptom_entities(user_message)
    ai_response = get_ai_response(
        user_message,
        language_preference=language_preference,
        triage=triage,
        entities=entities,
        patient_context=_build_ai_patient_context(_get_patient_snapshot(user)),
    )
    follow_up_questions = generate_follow_up_questions(entities=entities, triage=triage)
    ai_response = _append_questions(ai_response, follow_up_questions)

    if user and user["role"] == "patient":
        hospital_id, assigned_doctor_id, assigned_doctor_name, assigned_doctor_specialty = _resolve_care_assignment(
            user,
            user_message=user_message,
            entities=entities,
        )
        previous_patient = _safe_execute("load patient snapshot", lambda: get_patient_by_user_id(str(user["_id"])), default=None)
        deterioration = _deterioration_patient_payload(previous_patient, triage, entities)
        appointment_risk = _appointment_risk_patient_payload(
            previous_patient=previous_patient,
            triage=triage,
            entities=entities,
            current_status="Monitoring",
            deterioration=deterioration,
        )
        prediction = _deterioration_prediction_patient_payload(
            previous_patient=previous_patient,
            triage=triage,
            entities=entities,
            current_status="Monitoring",
            deterioration=deterioration,
            appointment_risk=appointment_risk,
        )
        _safe_execute(
            "update patient monitoring profile",
            lambda: update_patient_profile(
                str(user["_id"]),
                {
                    "name": user["name"],
                    "email": user["email"],
                    "hospital_id": hospital_id,
                    "status": "Monitoring",
                    "assigned_doctor_id": assigned_doctor_id,
                    "assigned_doctor_name": assigned_doctor_name,
                    "assigned_doctor_specialty": assigned_doctor_specialty,
                    "last_summary": user_message,
                    **deterioration,
                    **appointment_risk,
                    **prediction,
                    **_follow_up_patient_payload(follow_up_questions),
                    **_summary_patient_payload(
                        patient_name=user["name"],
                        user_message=user_message,
                        triage=triage,
                        entities=entities,
                        current_status="Monitoring",
                    ),
                    **_triage_patient_payload(triage),
                    **_entity_patient_payload(entities),
                },
            ),
        )
        if triage.get("triage_label") in HIGH_RISK_TRIAGE_LABELS:
            _create_care_alerts(
                alert_type="high_risk_triage",
                title="High-risk patient message",
                message=f"{user['name']} triggered a {triage['triage_label'].lower()} triage assessment.",
                user=user,
                severity=triage["triage_label"].lower(),
                hospital_id=hospital_id,
                assigned_doctor_id=assigned_doctor_id,
                assigned_doctor_name=assigned_doctor_name,
                triage=triage,
            )

    _save_chat_if_possible(user, user_message, ai_response, triage=triage, entities=entities)
    return ai_response


def get_chat_history_response() -> dict[str, Any]:
    user = sanitize_user(g.current_user)
    if not user:
        raise ValidationError("User not found.")

    chat = get_chat_by_user_id(user["id"])
    serialized_chat = serialize_chat_history(chat)
    patient = (
        enrich_deterioration_prediction(serialize_document(get_patient_by_user_id(user["id"])))
        if user["role"] == "patient"
        else None
    )

    return {"chat": serialized_chat, "messages": serialized_chat["messages"], "patient": patient}
