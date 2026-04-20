from typing import Any, Optional

from models.base import serialize_document, utc_now
from services.db import get_database


def _collection():
    return get_database()["patient_memories"]


def ensure_patient_memory_indexes() -> None:
    _collection().create_index("user_id")
    _collection().create_index("hospital_id")
    _collection().create_index("created_at")
    _collection().create_index([("user_id", 1), ("created_at", -1)])


def create_patient_memory(memory: dict[str, Any]) -> Optional[dict[str, Any]]:
    if not memory.get("user_id") or not memory.get("content"):
        return None

    now = utc_now()
    document = {
        **memory,
        "created_at": now,
        "updated_at": now,
    }
    inserted = _collection().insert_one(document)
    return _collection().find_one({"_id": inserted.inserted_id})


def list_patient_memories(user_id: str, *, limit: int = 80) -> list[dict[str, Any]]:
    if not user_id:
        return []

    cursor = _collection().find({"user_id": user_id}).sort("created_at", -1).limit(limit)
    return [serialize_document(memory) for memory in cursor]
