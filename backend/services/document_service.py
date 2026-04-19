import re
import base64
import os
import uuid
from typing import Any

from flask import current_app
from bson import ObjectId

from models.document_model import create_document_record, get_document_by_id, list_documents
from models.appointment_model import get_appointment_by_id, update_appointment_record
from models.patient_model import get_patient_by_user_id
from models.user_model import DEFAULT_HOSPITAL_ID
from services.db import get_gridfs_bucket


class ValidationError(ValueError):
    pass


def _uploads_root() -> str:
    default_root = os.path.join(current_app.root_path, "uploads", "documents")
    root = current_app.config.get("UPLOADS_DIR", default_root)
    os.makedirs(root, exist_ok=True)
    return root


def _safe_file_name(file_name: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "_", file_name or "document")
    return cleaned[:120] or "document"


def _save_file_data(file_name: str, file_data_url: str, content_type: str = "") -> tuple[str, str, int]:
    if not file_data_url:
        return "", "", 0

    header, _, encoded = file_data_url.partition(",")
    if not encoded:
        raise ValidationError("Uploaded file data is invalid.")

    try:
        content = base64.b64decode(encoded)
    except Exception as exc:  # pragma: no cover - defensive invalid base64 path
        raise ValidationError("Unable to decode the uploaded file.") from exc

    try:
        upload_stream = get_gridfs_bucket().open_upload_stream(
            _safe_file_name(file_name),
            metadata={"content_type": content_type or "application/octet-stream"},
        )
        upload_stream.write(content)
        upload_stream.close()
        return "", str(upload_stream._id), len(content)
    except Exception:
        pass

    extension = os.path.splitext(file_name)[1]
    storage_name = f"{uuid.uuid4().hex}{extension}"
    absolute_path = os.path.join(_uploads_root(), storage_name)
    with open(absolute_path, "wb") as handle:
        handle.write(content)
    return storage_name, "", len(content)


def _normalize_document_type(value: str) -> str:
    normalized = (value or "").strip().lower()
    allowed = {"lab_report", "prescription", "discharge_note", "insurance", "other"}
    if normalized not in allowed:
        return "other"
    return normalized


TIMING_STOPWORDS = {
    "morning",
    "afternoon",
    "evening",
    "night",
    "daily",
    "times",
    "before",
    "after",
    "food",
    "breakfast",
    "lunch",
    "dinner",
    "once",
    "twice",
    "thrice",
    "tablet",
    "tablets",
    "capsule",
    "capsules",
    "syrup",
    "drops",
    "drop",
    "ml",
    "mg",
}
MED_NAME_PREFIXES = r"^(tab(?:let)?|cap(?:sule)?|syrup|syp|inj(?:ection)?|drop|drops)\.?\s+"
MED_DOSAGE_PATTERN = re.compile(r"(\d+(?:\.\d+)?\s?(?:mg|mcg|g|ml|iu|units?))", re.IGNORECASE)
COMMON_INSTRUCTION_WORDS = {"take", "use", "apply", "for", "x", "days", "day", "weeks", "week"}


def _normalize_timing(raw_text: str) -> str:
    lowered = raw_text.lower()
    schedule = []

    if "1-1-1" in lowered or "tds" in lowered or "tid" in lowered or "three times" in lowered:
        schedule = ["Morning", "Noon", "Night"]
    elif "1-0-1" in lowered or "bd" in lowered or "bid" in lowered or "twice" in lowered:
        schedule = ["Morning", "Night"]
    elif "1-0-0" in lowered or "od" in lowered or "qam" in lowered:
        schedule = ["Morning"]
    elif "0-1-0" in lowered:
        schedule = ["Noon"]
    elif "0-0-1" in lowered or "hs" in lowered:
        schedule = ["Night"]
    else:
        for keyword, label in [("morning", "Morning"), ("noon", "Noon"), ("afternoon", "Afternoon"), ("night", "Night"), ("evening", "Evening")]:
            if keyword in lowered and label not in schedule:
                schedule.append(label)

    qualifiers = []
    if "before food" in lowered or "before meal" in lowered:
        qualifiers.append("Before food")
    if "after food" in lowered or "after meal" in lowered:
        qualifiers.append("After food")
    if "sos" in lowered or "as needed" in lowered or "prn" in lowered:
        qualifiers.append("As needed")

    parts = schedule + qualifiers
    return ", ".join(parts) if parts else "Follow clinician instructions"


def _extract_drug_name(raw_text: str) -> str:
    cleaned = re.sub(MED_NAME_PREFIXES, "", raw_text.strip(), flags=re.IGNORECASE)
    cleaned = re.sub(r"^[\-\u2022\d.)\s]+", "", cleaned)
    tokens = []

    for token in cleaned.split():
        sanitized = token.strip(",.:;()[]")
        lowered = sanitized.lower()
        if not sanitized:
            continue
        if MED_DOSAGE_PATTERN.fullmatch(sanitized) or lowered in TIMING_STOPWORDS or lowered in COMMON_INSTRUCTION_WORDS:
            break
        if re.fullmatch(r"\d+(?:/\d+)?", sanitized):
            break
        if not re.match(r"^[A-Za-z][A-Za-z0-9/\-]*$", sanitized):
            break
        tokens.append(sanitized)
        if len(tokens) >= 3:
            break

    return " ".join(tokens)


def _derive_prescription_insights(notes: str, content_text: str, file_name: str = "", content_type: str = "") -> dict[str, Any]:
    combined = "\n".join(part for part in [notes, content_text] if part).strip()
    lines = [segment.strip(" -") for segment in re.split(r"[\n;]+", combined) if segment.strip()]
    medication_schedule = []
    seen = set()

    for line in lines:
        dosage_match = MED_DOSAGE_PATTERN.search(line)
        drug_name = _extract_drug_name(line)
        if not drug_name:
            continue
        lowered_name = drug_name.lower()
        if lowered_name in seen:
            continue
        seen.add(lowered_name)
        medication_schedule.append(
            {
                "drug_name": drug_name,
                "dosage": dosage_match.group(1) if dosage_match else "Not specified",
                "timing": _normalize_timing(line),
            }
        )

    if medication_schedule:
        meds_text = ", ".join(
            f"{item['drug_name']} ({item['dosage']}, {item['timing']})" for item in medication_schedule[:4]
        )
        summary = f"Prescription reviewed. Medicines identified: {meds_text}."
        return {
            "summary": summary,
            "prescription_summary": summary,
            "medication_schedule": medication_schedule,
            "review_priority": "Priority",
            "extracted_tags": [item["drug_name"].lower() for item in medication_schedule[:6]],
        }

    if file_name or content_type:
        summary = (
            "Prescription uploaded. Automatic medicine extraction works best when prescription text or notes are included."
        )
    else:
        summary = "Prescription uploaded for clinician review."

    return {
        "summary": summary,
        "prescription_summary": summary,
        "medication_schedule": [],
        "review_priority": "Priority",
        "extracted_tags": ["prescription"],
    }


def _derive_summary(document_type: str, notes: str, content_text: str, *, file_name: str = "", content_type: str = "") -> dict[str, Any]:
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

    if document_type == "prescription":
        return _derive_prescription_insights(notes, content_text, file_name=file_name, content_type=content_type)

    type_label = document_type.replace("_", " ").title()
    summary = (
        f"{type_label} uploaded for review."
        if not combined
        else f"{type_label} uploaded with notes about {combined[:220]}{'...' if len(combined) > 220 else ''}"
    )

    return {
        "summary": summary,
        "prescription_summary": "",
        "medication_schedule": [],
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
    file_data_url = (payload.get("file_data_url") or "").strip()
    document_type = _normalize_document_type(payload.get("document_type") or "other")
    file_size = int(payload.get("file_size") or 0)

    if not title:
      raise ValidationError("Document title is required.")

    storage_key = ""
    storage_gridfs_file_id = ""
    if file_data_url and file_name:
        storage_key, storage_gridfs_file_id, saved_size = _save_file_data(_safe_file_name(file_name), file_data_url, content_type)
        file_size = saved_size or file_size

    patient_profile = get_patient_by_user_id(str(user["_id"])) or {}
    hospital_id = user.get("hospital_id") or patient_profile.get("hospital_id") or DEFAULT_HOSPITAL_ID
    assigned_doctor_id = patient_profile.get("assigned_doctor_id")
    assigned_doctor_name = patient_profile.get("assigned_doctor_name", "")
    derived = _derive_summary(document_type, notes, content_text, file_name=file_name, content_type=content_type)

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
            "storage_key": storage_key,
            "storage_gridfs_file_id": storage_gridfs_file_id,
            "content_text": content_text[:4000],
            "summary": derived["summary"],
            "prescription_summary": derived.get("prescription_summary", ""),
            "medication_schedule": derived.get("medication_schedule", []),
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


def get_document_record_for_user(document_id: str, user: dict[str, Any]) -> dict[str, Any]:
    document = get_document_by_id(document_id)
    if not document:
        raise ValidationError("Document not found.")

    role = user.get("role")
    if role == "patient" and document.get("patient_user_id") != str(user["_id"]):
        raise ValidationError("You can only access your own documents.")
    if role == "doctor" and document.get("assigned_doctor_id") != str(user["_id"]):
        raise ValidationError("You can only access documents assigned to you.")
    if role == "hospital_admin" and document.get("hospital_id") != user.get("hospital_id"):
        raise ValidationError("You can only access documents from your hospital.")

    return document


def create_clinician_document(payload: dict[str, Any], user: dict[str, Any]) -> dict[str, Any]:
    if user.get("role") not in {"doctor", "hospital_admin"}:
        raise ValidationError("Only clinicians can attach consultation documents.")

    appointment_id = (payload.get("appointment_id") or "").strip()
    if not appointment_id:
        raise ValidationError("Appointment ID is required.")

    appointment = get_appointment_by_id(appointment_id)
    if not appointment:
        raise ValidationError("Appointment not found.")

    if user.get("role") == "doctor" and appointment.get("assigned_doctor_id") != str(user["_id"]):
        raise ValidationError("You can only attach records to your own appointments.")

    title = (payload.get("title") or "").strip()
    notes = (payload.get("notes") or "").strip()
    file_name = (payload.get("file_name") or "").strip()
    content_type = (payload.get("content_type") or "").strip()
    content_text = (payload.get("content_text") or "").strip()
    file_data_url = (payload.get("file_data_url") or "").strip()
    document_type = _normalize_document_type(payload.get("document_type") or "other")
    file_size = int(payload.get("file_size") or 0)

    if not title:
        raise ValidationError("Document title is required.")

    storage_key = ""
    storage_gridfs_file_id = ""
    if file_data_url and file_name:
        storage_key, storage_gridfs_file_id, saved_size = _save_file_data(_safe_file_name(file_name), file_data_url, content_type)
        file_size = saved_size or file_size

    derived = _derive_summary(document_type, notes, content_text, file_name=file_name, content_type=content_type)
    document = create_document_record(
        {
            "appointment_id": appointment_id,
            "patient_user_id": appointment.get("patient_user_id"),
            "patient_name": appointment.get("patient_name"),
            "patient_email": appointment.get("patient_email"),
            "uploaded_by_user_id": str(user["_id"]),
            "uploaded_by_name": user.get("name"),
            "hospital_id": appointment.get("hospital_id"),
            "assigned_doctor_id": appointment.get("assigned_doctor_id"),
            "assigned_doctor_name": appointment.get("assigned_doctor_name"),
            "document_type": document_type,
            "title": title,
            "notes": notes,
            "file_name": file_name,
            "content_type": content_type,
            "file_size": file_size,
            "storage_key": storage_key,
            "storage_gridfs_file_id": storage_gridfs_file_id,
            "content_text": content_text[:4000],
            "summary": derived["summary"],
            "prescription_summary": derived.get("prescription_summary", ""),
            "medication_schedule": derived.get("medication_schedule", []),
            "extracted_tags": derived["extracted_tags"],
            "review_priority": derived["review_priority"],
            "status": "uploaded",
            "source": "clinician",
        }
    )

    if document_type == "prescription":
        update_appointment_record(appointment_id, {"prescription_summary": document.get("prescription_summary") or document.get("summary") or ""})
    elif document_type in {"lab_report", "discharge_note", "other"}:
        update_appointment_record(appointment_id, {"scan_summary": document.get("summary") or ""})

    return document


def get_document_binary_for_user(document_id: str, user: dict[str, Any]) -> tuple[dict[str, Any], Any]:
    document = get_document_record_for_user(document_id, user)
    gridfs_file_id = document.get("storage_gridfs_file_id")
    if not gridfs_file_id:
        raise ValidationError("This document is not stored in GridFS.")

    try:
        download_stream = get_gridfs_bucket().open_download_stream(ObjectId(gridfs_file_id))
        return document, download_stream
    except Exception as exc:  # pragma: no cover - defensive storage error
        raise ValidationError("Stored file could not be opened.") from exc
