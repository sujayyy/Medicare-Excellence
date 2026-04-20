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
from services.document_ai_service import extract_clinical_document_entities, extract_document_text


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


def _derive_prescription_insights(
    notes: str,
    content_text: str,
    file_name: str = "",
    content_type: str = "",
    *,
    file_data_url: str = "",
) -> dict[str, Any]:
    extracted = extract_document_text(
        notes=notes,
        content_text=content_text,
        file_name=file_name,
        content_type=content_type,
        file_data_url=file_data_url,
    )
    entities = extract_clinical_document_entities(
        document_type="prescription",
        document_text=extracted["combined_text"],
        ai_medication_schedule=extracted.get("medication_schedule"),
        ai_interpretation_notes=extracted.get("ai_interpretation_notes", ""),
    )
    medication_schedule = entities["medication_schedule"]
    extracted_tags = [item["drug_name"].lower() for item in medication_schedule[:6]] or ["prescription"]

    if medication_schedule:
        meds_text = ", ".join(
            f"{item['drug_name']} ({item['dosage']}, {item['timing']}, {item['duration']})"
            for item in medication_schedule[:4]
        )
        source_hint = "AI handwriting interpretation" if extracted["ocr_status"] == "ai_handwriting_interpreted" else "OCR" if extracted["ocr_status"] == "ocr_extracted" else "text analysis"
        summary = f"Prescription reviewed with {source_hint}. Medicines identified: {meds_text}."
    elif extracted["combined_text"]:
        summary = (
            "Prescription uploaded. Some text was detected, but medicine extraction confidence is low. "
            "Add clearer notes or typed prescription text for better results."
        )
    elif file_name or content_type:
        summary = (
            "Prescription uploaded. OCR text could not be extracted from the file in this environment. "
            "Add typed prescription notes for medicine guidance."
        )
    else:
        summary = "Prescription uploaded for clinician review."

    return {
        "summary": summary,
        "prescription_summary": summary,
        "medication_schedule": medication_schedule,
        "review_priority": "Priority",
        "extracted_tags": extracted_tags,
        "ocr_status": extracted["ocr_status"],
        "ocr_source": extracted["ocr_source"],
        "ocr_text_excerpt": extracted["ocr_text_excerpt"],
        "extraction_model": extracted["extraction_model"],
        "extraction_confidence": entities["extraction_confidence"],
        "ai_interpretation_notes": entities.get("ai_interpretation_notes", ""),
        "document_domain": entities.get("document_domain", "prescription"),
        "structured_findings": entities.get("structured_findings", []),
        "abnormal_findings": entities.get("abnormal_findings", []),
        "clinical_highlights": entities.get("clinical_highlights", []),
        "follow_up_recommendations": entities.get("follow_up_recommendations", []),
        "content_text": extracted["combined_text"][:4000],
    }


def _derive_summary(
    document_type: str,
    notes: str,
    content_text: str,
    *,
    file_name: str = "",
    content_type: str = "",
    file_data_url: str = "",
) -> dict[str, Any]:
    extracted = extract_document_text(
        notes=notes,
        content_text=content_text,
        file_name=file_name,
        content_type=content_type,
        file_data_url=file_data_url,
    )
    combined = extracted["combined_text"]
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
        return _derive_prescription_insights(
            notes,
            content_text,
            file_name=file_name,
            content_type=content_type,
            file_data_url=file_data_url,
        )

    document_entities = extract_clinical_document_entities(
        document_type=document_type,
        document_text=combined,
    )

    type_label = document_type.replace("_", " ").title()
    summary = (
        f"{type_label} uploaded for review."
        if not combined
        else f"{type_label} uploaded with notes about {combined[:220]}{'...' if len(combined) > 220 else ''}"
    )

    if document_entities.get("abnormal_findings"):
        summary = f"{type_label} reviewed. Key concern: {document_entities['abnormal_findings'][0]}"
    elif document_entities.get("clinical_highlights"):
        summary = f"{type_label} reviewed. Key finding: {document_entities['clinical_highlights'][0]}"
    elif document_type == "discharge_note" and document_entities.get("discharge_risk_summary"):
        summary = document_entities["discharge_risk_summary"]

    if document_type == "lab_report" and document_entities.get("abnormal_value_count", 0) > 0:
        summary = (
            f"Lab report reviewed with {document_entities['abnormal_value_count']} abnormal value(s). "
            f"Top concern: {document_entities['abnormal_findings'][0]}"
        )
    if document_type == "discharge_note" and document_entities.get("discharge_risk_level") == "high":
        review_priority = "Urgent"
    if document_type == "lab_report" and document_entities.get("lab_alert_level") in {"high", "critical"}:
        review_priority = "Urgent"
    elif document_type == "lab_report" and document_entities.get("lab_alert_level") == "medium":
        review_priority = "Priority"

    extracted_tags = list(extracted_tags)
    extracted_tags.extend(document_entities.get("analytes_detected", []))
    extracted_tags.extend(document_entities.get("discharge_red_flags", [])[:2])
    extracted_tags = list(dict.fromkeys([tag for tag in extracted_tags if tag]))[:10]

    return {
        "summary": summary,
        "prescription_summary": "",
        "medication_schedule": [],
        "extracted_tags": extracted_tags,
        "review_priority": "Urgent" if document_entities.get("abnormal_findings") else review_priority,
        "ocr_status": extracted.get("ocr_status", "not_applicable"),
        "ocr_source": extracted.get("ocr_source", "manual_text"),
        "ocr_text_excerpt": extracted.get("ocr_text_excerpt", ""),
        "extraction_model": extracted.get("extraction_model", "ocr-nlp-prescription-v1"),
        "extraction_confidence": document_entities.get("extraction_confidence", 0.0),
        "ai_interpretation_notes": extracted.get("ai_interpretation_notes", ""),
        "document_domain": document_entities.get("document_domain", document_type),
        "structured_findings": document_entities.get("structured_findings", []),
        "abnormal_findings": document_entities.get("abnormal_findings", []),
        "clinical_highlights": document_entities.get("clinical_highlights", []),
        "follow_up_recommendations": document_entities.get("follow_up_recommendations", []),
        "lab_alert_level": document_entities.get("lab_alert_level", "low"),
        "abnormal_value_count": document_entities.get("abnormal_value_count", 0),
        "analytes_detected": document_entities.get("analytes_detected", []),
        "discharge_risk_level": document_entities.get("discharge_risk_level", "low"),
        "discharge_risk_summary": document_entities.get("discharge_risk_summary", ""),
        "discharge_key_diagnoses": document_entities.get("discharge_key_diagnoses", []),
        "discharge_procedures": document_entities.get("discharge_procedures", []),
        "discharge_red_flags": document_entities.get("discharge_red_flags", []),
        "content_text": combined[:4000],
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
    derived = _derive_summary(
        document_type,
        notes,
        content_text,
        file_name=file_name,
        content_type=content_type,
        file_data_url=file_data_url,
    )

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
            "content_text": derived.get("content_text", content_text[:4000]),
            "summary": derived["summary"],
            "prescription_summary": derived.get("prescription_summary", ""),
            "medication_schedule": derived.get("medication_schedule", []),
            "extracted_tags": derived["extracted_tags"],
            "review_priority": derived["review_priority"],
            "ocr_status": derived.get("ocr_status", "not_applicable"),
            "ocr_source": derived.get("ocr_source", "manual_text"),
            "ocr_text_excerpt": derived.get("ocr_text_excerpt", ""),
            "extraction_model": derived.get("extraction_model", "ocr-nlp-prescription-v1"),
            "extraction_confidence": derived.get("extraction_confidence", 0.0),
            "ai_interpretation_notes": derived.get("ai_interpretation_notes", ""),
            "document_domain": derived.get("document_domain", document_type),
            "structured_findings": derived.get("structured_findings", []),
            "abnormal_findings": derived.get("abnormal_findings", []),
            "clinical_highlights": derived.get("clinical_highlights", []),
            "follow_up_recommendations": derived.get("follow_up_recommendations", []),
            "lab_alert_level": derived.get("lab_alert_level", "low"),
            "abnormal_value_count": derived.get("abnormal_value_count", 0),
            "analytes_detected": derived.get("analytes_detected", []),
            "discharge_risk_level": derived.get("discharge_risk_level", "low"),
            "discharge_risk_summary": derived.get("discharge_risk_summary", ""),
            "discharge_key_diagnoses": derived.get("discharge_key_diagnoses", []),
            "discharge_procedures": derived.get("discharge_procedures", []),
            "discharge_red_flags": derived.get("discharge_red_flags", []),
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

    derived = _derive_summary(
        document_type,
        notes,
        content_text,
        file_name=file_name,
        content_type=content_type,
        file_data_url=file_data_url,
    )
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
            "content_text": derived.get("content_text", content_text[:4000]),
            "summary": derived["summary"],
            "prescription_summary": derived.get("prescription_summary", ""),
            "medication_schedule": derived.get("medication_schedule", []),
            "extracted_tags": derived["extracted_tags"],
            "review_priority": derived["review_priority"],
            "ocr_status": derived.get("ocr_status", "not_applicable"),
            "ocr_source": derived.get("ocr_source", "manual_text"),
            "ocr_text_excerpt": derived.get("ocr_text_excerpt", ""),
            "extraction_model": derived.get("extraction_model", "ocr-nlp-prescription-v1"),
            "extraction_confidence": derived.get("extraction_confidence", 0.0),
            "ai_interpretation_notes": derived.get("ai_interpretation_notes", ""),
            "document_domain": derived.get("document_domain", document_type),
            "structured_findings": derived.get("structured_findings", []),
            "abnormal_findings": derived.get("abnormal_findings", []),
            "clinical_highlights": derived.get("clinical_highlights", []),
            "follow_up_recommendations": derived.get("follow_up_recommendations", []),
            "lab_alert_level": derived.get("lab_alert_level", "low"),
            "abnormal_value_count": derived.get("abnormal_value_count", 0),
            "analytes_detected": derived.get("analytes_detected", []),
            "discharge_risk_level": derived.get("discharge_risk_level", "low"),
            "discharge_risk_summary": derived.get("discharge_risk_summary", ""),
            "discharge_key_diagnoses": derived.get("discharge_key_diagnoses", []),
            "discharge_procedures": derived.get("discharge_procedures", []),
            "discharge_red_flags": derived.get("discharge_red_flags", []),
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
