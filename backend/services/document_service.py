from typing import Any

from models.document_model import create_document_record, list_documents
from models.patient_model import get_patient_by_user_id
from models.user_model import DEFAULT_HOSPITAL_ID


class ValidationError(ValueError):
    pass


def _normalize_document_type(value: str) -> str:
    normalized = (value or "").strip().lower()
    allowed = {"lab_report", "prescription", "discharge_note", "insurance", "other"}
    if normalized not in allowed:
        return "other"
    return normalized


def _derive_summary(document_type: str, notes: str, content_text: str) -> dict[str, Any]:
    combined = " ".join(part for part in [notes, content_text] if part).strip()
    lowered = combined.lower()
    extracted_tags = []
    for keyword in ["fever", "cough", "chest pain", "shortness of breath", "bp", "blood pressure", "sugar", "glucose", "allergy", "antibiotic"]:
        if keyword in lowered and keyword not in extracted_tags:
            extracted_tags.append(keyword)

    review_priority = "Routine"
    if any(flag in lowered for flag in ["chest pain", "shortness of breath", "critical", "urgent", "allergy"]):
        review_priority = "Urgent"
    elif any(flag in lowered for flag in ["fever", "cough", "infection", "pain", "antibiotic"]):
        review_priority = "Priority"

    type_label = document_type.replace("_", " ").title()
    summary = (
        f"{type_label} uploaded for review."
        if not combined
        else f"{type_label} uploaded with notes about {combined[:220]}{'...' if len(combined) > 220 else ''}"
    )

    return {
        "summary": summary,
        "extracted_tags": extracted_tags,
        "review_priority": review_priority,
    }


def create_patient_document(payload: dict[str, Any], user: dict[str, Any]) -> dict[str, Any]:
    if user.get("role") != "patient":
        raise ValidationError("Only patients can upload documents.")

    title = (payload.get("title") or "").strip()
    notes = (payload.get("notes") or "").strip()
    file_name = (payload.get("file_name") or "").strip()
    content_type = (payload.get("content_type") or "").strip()
    content_text = (payload.get("content_text") or "").strip()
    document_type = _normalize_document_type(payload.get("document_type") or "other")
    file_size = int(payload.get("file_size") or 0)

    if not title:
      raise ValidationError("Document title is required.")

    patient_profile = get_patient_by_user_id(str(user["_id"])) or {}
    hospital_id = user.get("hospital_id") or patient_profile.get("hospital_id") or DEFAULT_HOSPITAL_ID
    assigned_doctor_id = patient_profile.get("assigned_doctor_id")
    assigned_doctor_name = patient_profile.get("assigned_doctor_name", "")
    derived = _derive_summary(document_type, notes, content_text)

    return create_document_record(
        {
            "patient_user_id": str(user["_id"]),
            "patient_name": user.get("name"),
            "patient_email": user.get("email"),
            "uploaded_by_user_id": str(user["_id"]),
            "uploaded_by_name": user.get("name"),
            "hospital_id": hospital_id,
            "assigned_doctor_id": assigned_doctor_id,
            "assigned_doctor_name": assigned_doctor_name,
            "document_type": document_type,
            "title": title,
            "notes": notes,
            "file_name": file_name,
            "content_type": content_type,
            "file_size": file_size,
            "content_text": content_text[:4000],
            "summary": derived["summary"],
            "extracted_tags": derived["extracted_tags"],
            "review_priority": derived["review_priority"],
            "status": "uploaded",
        }
    )


def get_document_records(user: dict[str, Any]) -> list[dict[str, Any]]:
    role = user.get("role")
    if role == "patient":
        return list_documents(patient_user_id=str(user["_id"]))
    if role == "doctor":
        return list_documents(hospital_id=user.get("hospital_id"), assigned_doctor_id=str(user["_id"]))
    return list_documents(hospital_id=user.get("hospital_id"))
