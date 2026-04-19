from typing import Any, Optional

from models.base import serialize_document, to_object_id, utc_now, with_timestamps
from services.db import get_database


def _collection():
    return get_database()["appointments"]


def ensure_appointment_indexes() -> None:
    _collection().create_index("hospital_id")
    _collection().create_index("patient_user_id")
    _collection().create_index("assigned_doctor_id")
    _collection().create_index("status")
    _collection().create_index("appointment_date")
    _collection().create_index("updated_at")


def create_appointment_record(payload: dict[str, Any]) -> dict[str, Any]:
    document = with_timestamps(payload)
    result = _collection().insert_one(document)
    document["_id"] = result.inserted_id
    return serialize_document(document)


def get_appointment_by_id(appointment_id: str) -> Optional[dict[str, Any]]:
    object_id = to_object_id(appointment_id)
    if not object_id:
        return None
    appointment = _collection().find_one({"_id": object_id})
    return serialize_document(appointment)


def update_appointment_record(appointment_id: str, updates: dict[str, Any]) -> Optional[dict[str, Any]]:
    object_id = to_object_id(appointment_id)
    if not object_id:
        return None
    _collection().update_one({"_id": object_id}, {"$set": {**updates, "updated_at": utc_now()}})
    appointment = _collection().find_one({"_id": object_id})
    return serialize_document(appointment)


def list_appointments(
    *,
    hospital_id: Optional[str] = None,
    patient_user_id: Optional[str] = None,
    assigned_doctor_id: Optional[str] = None,
    appointment_date: Optional[str] = None,
) -> list[dict[str, Any]]:
    query: dict[str, Any] = {}
    if hospital_id:
        query["hospital_id"] = hospital_id
    if patient_user_id:
        query["patient_user_id"] = patient_user_id
    if assigned_doctor_id:
        query["assigned_doctor_id"] = assigned_doctor_id
    if appointment_date:
        query["appointment_date"] = appointment_date
    appointments = _collection().find(query).sort([("appointment_date", 1), ("appointment_time", 1), ("created_at", -1)])
    return [serialize_document(item) for item in appointments]
