from typing import Any, Optional

from models.base import serialize_document, to_object_id, utc_now
from services.db import get_database


def _collection():
    return get_database()["documents"]


def ensure_document_indexes() -> None:
    _collection().create_index("patient_user_id")
    _collection().create_index("hospital_id")
    _collection().create_index("assigned_doctor_id")
    _collection().create_index("appointment_id")
    _collection().create_index("uploaded_by_user_id")
    _collection().create_index("created_at")


def create_document_record(document: dict[str, Any]) -> dict[str, Any]:
    now = utc_now()
    payload = {
        **document,
        "created_at": now,
        "updated_at": now,
    }
    result = _collection().insert_one(payload)
    created = _collection().find_one({"_id": result.inserted_id})
    return serialize_document(created) or {}


def get_document_by_id(document_id: str) -> Optional[dict[str, Any]]:
    object_id = to_object_id(document_id)
    if not object_id:
        return None
    return serialize_document(_collection().find_one({"_id": object_id}))


def list_documents(
    *,
    hospital_id: Optional[str] = None,
    patient_user_id: Optional[str] = None,
    assigned_doctor_id: Optional[str] = None,
    appointment_id: Optional[str] = None,
) -> list[dict[str, Any]]:
    query: dict[str, Any] = {}
    if hospital_id:
        query["hospital_id"] = hospital_id
    if patient_user_id:
        query["patient_user_id"] = patient_user_id
    if assigned_doctor_id:
        query["assigned_doctor_id"] = assigned_doctor_id
    if appointment_id:
        query["appointment_id"] = appointment_id

    documents = _collection().find(query).sort("created_at", -1)
    return [serialize_document(document) for document in documents]
