from datetime import timedelta
from typing import Any, Optional

from models.base import serialize_document, utc_now
from services.db import get_database


def _collection():
    return get_database()["emergencies"]


def ensure_emergency_indexes() -> None:
    _collection().create_index("hospital_id")
    _collection().create_index("assigned_doctor_id")
    _collection().create_index("dedupe_key")
    _collection().create_index("status")
    _collection().create_index("created_at")
    _collection().create_index("user_id")


def _build_dedupe_key(document: dict[str, Any]) -> str:
    return "|".join(
        [
            str(document.get("hospital_id") or ""),
            str(document.get("user_id") or ""),
            str(document.get("patient_name") or ""),
            str(document.get("message") or ""),
            str(document.get("severity") or ""),
        ]
    )


def create_emergency_log(document: dict[str, Any]) -> dict[str, Any]:
    now = utc_now()
    dedupe_key = _build_dedupe_key(document)
    existing = _collection().find_one(
        {
            "dedupe_key": dedupe_key,
            "status": document.get("status", "open"),
            "created_at": {"$gte": now - timedelta(minutes=15)},
        },
        sort=[("created_at", -1)],
    )
    if existing:
        _collection().update_one(
            {"_id": existing["_id"]},
            {
                "$set": {"updated_at": now},
                "$inc": {"occurrence_count": 1},
            },
        )
        existing["updated_at"] = now
        existing["occurrence_count"] = int(existing.get("occurrence_count", 1)) + 1
        return existing

    payload = {
        **document,
        "dedupe_key": dedupe_key,
        "status": document.get("status", "open"),
        "source": document.get("source", "chat"),
        "occurrence_count": 1,
        "created_at": now,
        "updated_at": now,
    }
    result = _collection().insert_one(payload)
    payload["_id"] = result.inserted_id
    return payload


def list_emergencies(*, hospital_id: Optional[str] = None, assigned_doctor_id: Optional[str] = None) -> list[dict[str, Any]]:
    query: dict[str, Any] = {}
    if hospital_id:
        query["hospital_id"] = hospital_id
    if assigned_doctor_id:
        query["assigned_doctor_id"] = assigned_doctor_id

    emergencies = _collection().find(query).sort("created_at", -1)
    serialized_emergencies = [serialize_document(emergency) for emergency in emergencies]
    deduped: list[dict[str, Any]] = []
    seen_keys: set[str] = set()

    for emergency in serialized_emergencies:
        dedupe_key = emergency.get("dedupe_key") or emergency.get("id")
        if dedupe_key in seen_keys:
            continue
        seen_keys.add(dedupe_key)
        deduped.append(emergency)

    return deduped
