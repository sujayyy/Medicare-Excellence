from typing import Any, Optional

from pymongo.errors import DuplicateKeyError, OperationFailure

from models.base import serialize_document, to_object_id, utc_now, with_timestamps
from services.db import get_database

DEFAULT_HOSPITAL_ID = "medicare-excellence-general"
DEFAULT_DOCTOR_SPECIALTY = "general_medicine"


def _collection():
    return get_database()["users"]


def ensure_user_indexes() -> None:
    _collection().create_index("role")
    _collection().create_index("hospital_id")
    _collection().create_index("specialty")
    try:
        _collection().create_index("email", unique=True)
    except (DuplicateKeyError, OperationFailure):
        _collection().create_index("email")


def get_user_by_email(email: str) -> Optional[dict[str, Any]]:
    return _collection().find_one({"email": email.strip().lower()})


def get_users_by_email(email: str) -> list[dict[str, Any]]:
    return list(_collection().find({"email": email.strip().lower()}))


def get_user_by_id(user_id: str) -> Optional[dict[str, Any]]:
    object_id = to_object_id(user_id)
    if not object_id:
        return None
    return _collection().find_one({"_id": object_id})


def list_users_by_role(role: str, *, hospital_id: Optional[str] = None) -> list[dict[str, Any]]:
    query: dict[str, Any] = {"role": role}
    if hospital_id:
        query["hospital_id"] = hospital_id
    return list(_collection().find(query).sort("name", 1))


def get_primary_doctor_for_hospital(hospital_id: Optional[str]) -> Optional[dict[str, Any]]:
    effective_hospital_id = hospital_id or DEFAULT_HOSPITAL_ID
    return _collection().find_one({"role": "doctor", "hospital_id": effective_hospital_id}, sort=[("created_at", 1)])


def get_doctor_for_specialty(hospital_id: Optional[str], specialty: Optional[str]) -> Optional[dict[str, Any]]:
    effective_hospital_id = hospital_id or DEFAULT_HOSPITAL_ID
    normalized_specialty = (specialty or DEFAULT_DOCTOR_SPECIALTY).strip().lower()
    doctor = _collection().find_one(
        {"role": "doctor", "hospital_id": effective_hospital_id, "specialty": normalized_specialty},
        sort=[("created_at", 1)],
    )
    if doctor:
        return doctor
    if normalized_specialty != DEFAULT_DOCTOR_SPECIALTY:
        return _collection().find_one(
            {"role": "doctor", "hospital_id": effective_hospital_id, "specialty": DEFAULT_DOCTOR_SPECIALTY},
            sort=[("created_at", 1)],
        )
    return get_primary_doctor_for_hospital(effective_hospital_id)


def create_user(
    name: str,
    email: str,
    password_hash: str,
    role: str,
    *,
    hospital_id: Optional[str] = None,
    specialty: Optional[str] = None,
) -> dict[str, Any]:
    document = with_timestamps(
        {
            "name": name.strip(),
            "email": email.strip().lower(),
            "password_hash": password_hash,
            "role": role,
            "hospital_id": hospital_id or DEFAULT_HOSPITAL_ID,
            "specialty": specialty or (DEFAULT_DOCTOR_SPECIALTY if role == "doctor" else None),
            "last_login_at": None,
        }
    )
    result = _collection().insert_one(document)
    document["_id"] = result.inserted_id
    return document


def update_last_login(user_id: str) -> None:
    object_id = to_object_id(user_id)
    if not object_id:
        return

    _collection().update_one(
        {"_id": object_id},
        {"$set": {"last_login_at": utc_now(), "updated_at": utc_now()}},
    )


def update_user_fields(
    user_id: str,
    *,
    set_fields: dict[str, Any],
    unset_fields: Optional[dict[str, str]] = None,
) -> None:
    object_id = to_object_id(user_id)
    if not object_id:
        return

    update_doc: dict[str, Any] = {"$set": {**set_fields, "updated_at": utc_now()}}
    if unset_fields:
        update_doc["$unset"] = unset_fields

    _collection().update_one({"_id": object_id}, update_doc)


def migrate_legacy_password(user_id: str, password_hash: str) -> None:
    update_user_fields(
        user_id,
        set_fields={"password_hash": password_hash},
        unset_fields={"password": ""},
    )


def sanitize_user(user: Optional[dict[str, Any]]) -> Optional[dict[str, Any]]:
    serialized = serialize_document(user)
    if not serialized:
        return None
    serialized.pop("password_hash", None)
    serialized.pop("password", None)
    return serialized
