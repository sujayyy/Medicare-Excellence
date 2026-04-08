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
from services.doctor_routing_service import infer_specialty
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


def _has_appointment_details(user_message: str) -> bool:
    details = _extract_patient_details(user_message)
    return bool(details.get("name") and details.get("age") and details.get("phone"))


def _is_appointment_message(user_message: str) -> bool:
    lowered = user_message.lower()
    return any(keyword in lowered for keyword in APPOINTMENT_KEYWORDS)


def _is_emergency_message(user_message: str) -> bool:
    lowered = user_message.lower()
    return any(keyword in lowered for keyword in EMERGENCY_KEYWORDS)


def _appointment_intake_pending(user: Optional[dict[str, Any]]) -> bool:
    if not user or user.get("role") != "patient":
        return False

    patient = _safe_execute("load pending appointment state", lambda: get_patient_by_user_id(str(user["_id"])), default=None)
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


def _record_appointment(user_message: str, user: Optional[dict[str, Any]]) -> str:
    triage = assess_triage(user_message, appointment=True)
    entities = extract_symptom_entities(user_message)
    details = _extract_patient_details(user_message)
    hospital_id, assigned_doctor_id, assigned_doctor_name, assigned_doctor_specialty = _resolve_care_assignment(
        user,
        user_message=user_message,
        entities=entities,
    )
    previous_patient = _safe_execute("load patient snapshot", lambda: get_patient_by_user_id(str(user["_id"])), default=None) if user and user.get("role") == "patient" else None
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

    if _has_appointment_details(user_message):
        persisted = True
        if user and user["role"] == "patient":
            persisted = _safe_perform(
                "record patient appointment request",
                lambda: update_patient_profile(
                    str(user["_id"]),
                    {
                        "name": details.get("name") or user["name"],
                        "email": user["email"],
                        "hospital_id": hospital_id,
                        "phone": details.get("phone", ""),
                        "age": details.get("age"),
                        "status": "Appointment requested",
                        "appointment_intake_pending": False,
                        "assigned_doctor_id": assigned_doctor_id,
                        "assigned_doctor_name": assigned_doctor_name,
                        "assigned_doctor_specialty": assigned_doctor_specialty,
                        "last_summary": user_message,
                        **requested_deterioration,
                        **requested_appointment_risk,
                        **requested_prediction,
                        **_follow_up_patient_payload([]),
                        **_summary_patient_payload(
                            patient_name=details.get("name") or user["name"],
                            user_message=user_message,
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
            return "I captured your appointment details, but the booking system is temporarily unavailable. Please try again shortly."

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
        return "Your appointment request has been recorded successfully. Our team will contact you shortly."

    if user and user["role"] == "patient":
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

    return "Please provide your name, age, and contact number to book the appointment."


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
            f"Emergency recorded successfully with reference {str(emergency_log['_id'])[-6:].upper()}. "
            "Please contact local emergency services immediately if the symptoms are severe or worsening."
        )
        if follow_up_questions:
            response = (
                f"{response}\n\n{get_follow_up_intro(emergency=True)}\n"
                + "\n".join(f"- {question}" for question in follow_up_questions)
            )
        return response

    response = (
        "Your symptoms may require urgent in-person care. Please contact local emergency services or the hospital immediately."
    )
    if follow_up_questions:
        response = (
            f"{response}\n\n{get_follow_up_intro(emergency=True)}\n"
            + "\n".join(f"- {question}" for question in follow_up_questions)
        )
    return response


def process_chat_message(payload: dict[str, Any], *, user: Optional[dict[str, Any]] = None) -> str:
    user_message = (payload.get("message") or "").strip()
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

    if _is_appointment_message(user_message):
        entities = extract_symptom_entities(user_message)
        response = _record_appointment(user_message, user)
        _save_chat_if_possible(
            user,
            user_message,
            response,
            triage=assess_triage(user_message, appointment=True),
            entities=entities,
        )
        return response

    if _appointment_intake_pending(user) and _has_appointment_details(user_message):
        entities = extract_symptom_entities(user_message)
        response = _record_appointment(user_message, user)
        _save_chat_if_possible(
            user,
            user_message,
            response,
            triage=assess_triage(user_message, appointment=True),
            entities=entities,
        )
        return response

    ai_response = get_ai_response(user_message)
    triage = assess_triage(user_message)
    entities = extract_symptom_entities(user_message)
    follow_up_questions = generate_follow_up_questions(entities=entities, triage=triage)
    if follow_up_questions:
        ai_response = (
            f"{ai_response}\n\n{get_follow_up_intro()}\n"
            + "\n".join(f"- {question}" for question in follow_up_questions)
        )

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
