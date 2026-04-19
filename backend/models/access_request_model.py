from typing import Any, Optional

from models.base import serialize_document, to_object_id, utc_now, with_timestamps
from services.db import get_database


def _collection():
    return get_database()["access_requests"]


def ensure_access_request_indexes() -> None:
    _collection().create_index("email")
    _collection().create_index("hospital_id")
    _collection().create_index("status")
    _collection().create_index("requested_role")
    _collection().create_index("created_at")


def create_access_request(payload: dict[str, Any]) -> dict[str, Any]:
    document = with_timestamps(payload)
    result = _collection().insert_one(document)
    document["_id"] = result.inserted_id
    return serialize_document(document) or {}


def get_access_request_by_id(request_id: str) -> Optional[dict[str, Any]]:
    object_id = to_object_id(request_id)
    if not object_id:
        return None
    return serialize_document(_collection().find_one({"_id": object_id}))


def get_active_access_request_by_email(email: str) -> Optional[dict[str, Any]]:
    document = _collection().find_one(
        {"email": email.strip().lower(), "status": {"$in": ["pending", "approved"]}},
        sort=[("created_at", -1)],
    )
    return serialize_document(document)


def list_access_requests(*, hospital_id: Optional[str] = None, status: Optional[str] = None) -> list[dict[str, Any]]:
    query: dict[str, Any] = {}
    if hospital_id:
        query["hospital_id"] = hospital_id
    if status:
        query["status"] = status
    documents = _collection().find(query).sort([("created_at", -1)])
    return [serialize_document(document) for document in documents]


def update_access_request(request_id: str, updates: dict[str, Any]) -> Optional[dict[str, Any]]:
    object_id = to_object_id(request_id)
    if not object_id:
        return None
    _collection().update_one({"_id": object_id}, {"$set": {**updates, "updated_at": utc_now()}})
    return serialize_document(_collection().find_one({"_id": object_id}))
