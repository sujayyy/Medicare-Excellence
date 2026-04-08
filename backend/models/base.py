from datetime import datetime, timezone
from typing import Any, Optional

from bson import ObjectId
from bson.errors import InvalidId


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def with_timestamps(document: dict[str, Any], *, is_new: bool = True) -> dict[str, Any]:
    now = utc_now()
    if is_new and "created_at" not in document:
        document["created_at"] = now
    document["updated_at"] = now
    return document


def to_object_id(value: Optional[str]) -> Optional[ObjectId]:
    if not value:
        return None

    try:
        return ObjectId(value)
    except (InvalidId, TypeError):
        return None


def serialize_value(value: Any) -> Any:
    if isinstance(value, ObjectId):
        return str(value)
    if isinstance(value, datetime):
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        return value.isoformat()
    if isinstance(value, list):
        return [serialize_value(item) for item in value]
    if isinstance(value, dict):
        serialized: dict[str, Any] = {}
        for key, item in value.items():
            serialized["id" if key == "_id" else key] = serialize_value(item)
        return serialized
    return value


def serialize_document(document: Optional[dict[str, Any]]) -> Optional[dict[str, Any]]:
    if not document:
        return None
    return serialize_value(document)
