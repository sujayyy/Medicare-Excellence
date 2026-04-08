from datetime import timedelta
from typing import Any, Optional

from models.base import serialize_document, to_object_id, utc_now
from services.db import get_database


def _collection():
    return get_database()["alerts"]


def ensure_alert_indexes() -> None:
    _collection().create_index("hospital_id")
    _collection().create_index("target_user_id")
    _collection().create_index("target_role")
    _collection().create_index("dedupe_key")
    _collection().create_index("status")
    _collection().create_index("created_at")


def _build_dedupe_key(document: dict[str, Any]) -> str:
    return "|".join(
        [
            str(document.get("hospital_id") or ""),
            str(document.get("type") or ""),
            str(document.get("target_role") or ""),
            str(document.get("target_user_id") or ""),
            str(document.get("patient_user_id") or ""),
            str(document.get("message") or ""),
        ]
    )


def create_alert(document: dict[str, Any]) -> dict[str, Any]:
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
        "occurrence_count": 1,
        "created_at": now,
        "updated_at": now,
    }
    result = _collection().insert_one(payload)
    payload["_id"] = result.inserted_id
    return payload


def get_alert_by_id(alert_id: str) -> Optional[dict[str, Any]]:
    object_id = to_object_id(alert_id)
    if not object_id:
        return None
    return _collection().find_one({"_id": object_id})


def update_alert_status(
    alert_id: str,
    *,
    status: str,
    acknowledged_by_user_id: Optional[str] = None,
    acknowledged_by_name: Optional[str] = None,
) -> Optional[dict[str, Any]]:
    object_id = to_object_id(alert_id)
    if not object_id:
        return None

    now = utc_now()
    set_fields: dict[str, Any] = {
        "status": status,
        "updated_at": now,
    }
    if acknowledged_by_user_id:
        set_fields["acknowledged_by_user_id"] = acknowledged_by_user_id
    if acknowledged_by_name:
        set_fields["acknowledged_by_name"] = acknowledged_by_name
    if status != "open":
        set_fields["acknowledged_at"] = now

    _collection().update_one({"_id": object_id}, {"$set": set_fields})
    return get_alert_by_id(alert_id)


def list_alerts(
    *,
    hospital_id: Optional[str] = None,
    target_user_id: Optional[str] = None,
    target_role: Optional[str] = None,
    status: Optional[str] = None,
) -> list[dict[str, Any]]:
    query: dict[str, Any] = {}
    if hospital_id:
        query["hospital_id"] = hospital_id
    if target_user_id:
        query["target_user_id"] = target_user_id
    if target_role:
        query["target_role"] = target_role
    if status:
        query["status"] = status

    alerts = _collection().find(query).sort("created_at", -1)
    serialized_alerts = [serialize_document(alert) for alert in alerts]
    deduped: list[dict[str, Any]] = []
    seen_keys: set[str] = set()

    for alert in serialized_alerts:
        dedupe_key = alert.get("dedupe_key") or alert.get("id")
        if dedupe_key in seen_keys:
            continue
        seen_keys.add(dedupe_key)
        deduped.append(alert)

    return deduped
