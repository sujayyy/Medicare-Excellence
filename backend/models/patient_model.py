from datetime import datetime
from typing import Any, Optional

from models.base import serialize_document, utc_now
from services.db import get_database


def _collection():
    return get_database()["patients"]


def ensure_patient_indexes() -> None:
    _collection().create_index("user_id", unique=True, sparse=True)
    _collection().create_index("hospital_id")
    _collection().create_index("assigned_doctor_id")
    _collection().create_index("email")
    _collection().create_index("updated_at")


def calculate_age_from_dob(dob_value: Optional[str]) -> Optional[int]:
    if not dob_value:
        return None

    try:
        dob = datetime.strptime(str(dob_value)[:10], "%Y-%m-%d").date()
    except ValueError:
        return None

    today = utc_now().date()
    age = today.year - dob.year - ((today.month, today.day) < (dob.month, dob.day))
    if age < 0 or age > 120:
        return None
    return age


def create_or_update_patient_profile(user: dict[str, Any]) -> Optional[dict[str, Any]]:
    if not user or user.get("role") != "patient":
        return None

    existing_profile = get_patient_by_user_id(str(user["_id"])) or {}
    patient_dob = user.get("dob") or existing_profile.get("dob") or ""
    patient_phone = user.get("phone") or existing_profile.get("phone") or ""
    patient_gender = user.get("gender") or existing_profile.get("gender") or ""
    patient_age = calculate_age_from_dob(patient_dob) or existing_profile.get("age")
    now = utc_now()
    _collection().update_one(
        {"user_id": str(user["_id"])},
        {
            "$setOnInsert": {
                "created_at": now,
                "appointments_requested": 0,
                "emergency_count": 0,
                "risk_level": "Low",
                "triage_score": 20,
                "triage_label": "Low",
                "triage_reason": "No urgent symptom keywords were detected in the latest message.",
                "recommended_action": "Continue monitoring symptoms and use the assistant if anything changes.",
                "triage_updated_at": now,
                "symptoms": [],
                "duration_text": "",
                "body_parts": [],
                "medications_mentioned": [],
                "red_flags": [],
                "extracted_entities_updated_at": now,
                "status": "Active",
                "appointment_intake_pending": False,
                "appointment_intake_stage": "",
                "appointment_intake_data": {},
                "assigned_doctor_id": None,
                "assigned_doctor_name": "",
                "assigned_doctor_specialty": "",
                "summary_headline": "",
                "soap_summary": "",
                "clinical_summary": "",
                "clinical_note": "",
                "escalation_note": "",
                "summary_updated_at": now,
                "follow_up_questions": [],
                "follow_up_updated_at": now,
                "risk_trajectory": "stable",
                "worsening_flag": False,
                "repeat_symptom_count": 0,
                "repeated_symptoms": [],
                "appointment_risk_score": 15,
                "appointment_risk_label": "Low",
                "appointment_risk_reason": "No urgent scheduling risk was detected in the latest patient activity.",
                "followup_priority": "Routine follow-up",
                "followup_due_at": now,
                "appointment_risk_updated_at": now,
                "missed_followup_count": 0,
                "deterioration_prediction_score": 18,
                "deterioration_prediction_label": "Low",
                "deterioration_prediction_reason": "No strong near-term deterioration signal is visible from the current record.",
                "predicted_followup_window": "Routine 72-hour review",
                "prediction_next_check_at": now,
                "prediction_updated_at": now,
                "last_summary": "",
                "visit_history": [],
                "last_engagement_at": now,
            },
            "$set": {
                "user_id": str(user["_id"]),
                "hospital_id": user.get("hospital_id"),
                "name": user["name"],
                "email": user["email"],
                "phone": patient_phone,
                "dob": patient_dob,
                "gender": patient_gender,
                "age": patient_age,
                "updated_at": now,
                "last_interaction_at": now,
            },
        },
        upsert=True,
    )
    return get_patient_by_user_id(str(user["_id"]))


def get_patient_by_user_id(user_id: str) -> Optional[dict[str, Any]]:
    return _collection().find_one({"user_id": user_id})


def update_patient_profile(user_id: str, updates: dict[str, Any], *, increment: Optional[dict[str, int]] = None) -> None:
    now = utc_now()
    update_doc: dict[str, Any] = {
        "$set": {**updates, "updated_at": now, "last_interaction_at": now, "last_engagement_at": now},
        "$setOnInsert": {"created_at": now},
    }
    if increment:
        update_doc["$inc"] = increment
    _collection().update_one({"user_id": user_id}, update_doc, upsert=True)


def create_guest_patient_from_message(details: dict[str, Any]) -> None:
    now = utc_now()
    _collection().insert_one(
        {
            "name": details.get("name") or "Guest Patient",
            "email": details.get("email") or "",
            "hospital_id": details.get("hospital_id"),
            "phone": details.get("phone") or "",
            "dob": details.get("dob") or "",
            "gender": details.get("gender") or "",
            "age": details.get("age"),
            "status": "Appointment requested",
            "appointment_intake_pending": False,
            "appointment_intake_stage": "",
            "appointment_intake_data": {},
            "risk_level": "Medium",
            "triage_score": 30,
            "triage_label": "Low",
            "triage_reason": "This message appears to be appointment-related without urgent symptom language.",
            "recommended_action": "Proceed with routine scheduling and monitor for new symptoms.",
            "triage_updated_at": now,
            "symptoms": [],
            "duration_text": "",
            "body_parts": [],
            "medications_mentioned": [],
            "red_flags": [],
            "extracted_entities_updated_at": now,
            "assigned_doctor_id": details.get("assigned_doctor_id"),
            "assigned_doctor_name": details.get("assigned_doctor_name", ""),
            "assigned_doctor_specialty": details.get("assigned_doctor_specialty", ""),
            "summary_headline": "",
            "soap_summary": "",
            "clinical_summary": "",
            "clinical_note": "",
            "escalation_note": "",
            "summary_updated_at": now,
            "follow_up_questions": [],
            "follow_up_updated_at": now,
            "risk_trajectory": "stable",
            "worsening_flag": False,
            "repeat_symptom_count": 0,
            "repeated_symptoms": [],
            "appointment_risk_score": details.get("appointment_risk_score", 38),
            "appointment_risk_label": details.get("appointment_risk_label", "Medium"),
            "appointment_risk_reason": details.get(
                "appointment_risk_reason",
                "An appointment request is waiting for scheduling follow-up.",
            ),
            "followup_priority": details.get("followup_priority", "Book within 24 hours"),
            "followup_due_at": details.get("followup_due_at", now),
            "appointment_risk_updated_at": details.get("appointment_risk_updated_at", now),
            "missed_followup_count": details.get("missed_followup_count", 0),
            "deterioration_prediction_score": details.get("deterioration_prediction_score", 38),
            "deterioration_prediction_label": details.get("deterioration_prediction_label", "Medium"),
            "deterioration_prediction_reason": details.get(
                "deterioration_prediction_reason",
                "The patient should receive follow-up because a new care request is still active.",
            ),
            "predicted_followup_window": details.get("predicted_followup_window", "Within 24 hours"),
            "prediction_next_check_at": details.get("prediction_next_check_at", now),
            "prediction_updated_at": details.get("prediction_updated_at", now),
            "appointments_requested": 1,
            "emergency_count": 0,
            "last_summary": details.get("raw_text", ""),
            "visit_history": [],
            "last_interaction_at": now,
            "last_engagement_at": now,
            "created_at": now,
            "updated_at": now,
        }
    )


def list_patients(*, hospital_id: Optional[str] = None, assigned_doctor_id: Optional[str] = None) -> list[dict[str, Any]]:
    query: dict[str, Any] = {}
    if hospital_id:
        query["hospital_id"] = hospital_id
    if assigned_doctor_id:
        query["assigned_doctor_id"] = assigned_doctor_id

    patients = _collection().find(query).sort("updated_at", -1)
    return [serialize_document(patient) for patient in patients]


def upsert_visit_history_entry(user_id: str, visit_entry: dict[str, Any]) -> None:
    if not user_id or not visit_entry:
        return

    patient = get_patient_by_user_id(user_id) or {}
    existing_history = list(patient.get("visit_history") or [])
    appointment_id = visit_entry.get("appointment_id")

    next_history = [entry for entry in existing_history if entry.get("appointment_id") != appointment_id]
    next_history.insert(0, visit_entry)
    next_history.sort(key=lambda entry: entry.get("completed_at") or entry.get("created_at") or "", reverse=True)

    now = utc_now()
    _collection().update_one(
        {"user_id": user_id},
        {
            "$set": {
                "visit_history": next_history[:20],
                "updated_at": now,
                "last_interaction_at": now,
                "last_engagement_at": now,
            },
            "$setOnInsert": {"created_at": now},
        },
        upsert=True,
    )
