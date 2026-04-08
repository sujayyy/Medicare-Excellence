from typing import Any, Optional

from models.base import serialize_document, utc_now
from services.db import get_database


def _collection():
    return get_database()["chats"]


def ensure_chat_indexes() -> None:
    _collection().create_index("user_id", unique=True, sparse=True)
    _collection().create_index("hospital_id")
    _collection().create_index("updated_at")


def append_chat_messages(
    user: dict[str, Any],
    messages: list[dict[str, Any]],
    *,
    triage: Optional[dict[str, Any]] = None,
    entities: Optional[dict[str, Any]] = None,
) -> Optional[dict[str, Any]]:
    if not user:
        return None

    now = utc_now()
    sanitized_messages = [
        {"role": message["role"], "content": message["content"], "created_at": now}
        for message in messages
    ]

    set_fields: dict[str, Any] = {
        "updated_at": now,
        "last_message_at": now,
        "last_message_preview": sanitized_messages[-1]["content"][:140],
        "hospital_id": user.get("hospital_id"),
    }
    if triage:
        set_fields["latest_triage"] = triage
    if entities:
        set_fields["latest_entities"] = entities

    _collection().update_one(
        {"user_id": user["id"]},
        {
            "$setOnInsert": {
                "created_at": now,
                "user_id": user["id"],
                "user_name": user["name"],
                "user_email": user["email"],
                "role": user["role"],
                "hospital_id": user.get("hospital_id"),
            },
            "$set": set_fields,
            "$push": {"messages": {"$each": sanitized_messages}},
        },
        upsert=True,
    )

    return get_chat_by_user_id(user["id"])


def get_chat_by_user_id(user_id: str) -> Optional[dict[str, Any]]:
    return _collection().find_one({"user_id": user_id})


def serialize_chat_history(chat: Optional[dict[str, Any]]) -> dict[str, Any]:
    serialized = serialize_document(chat) or {}
    return {
        "id": serialized.get("id"),
        "user_id": serialized.get("user_id"),
        "messages": serialized.get("messages", []),
        "created_at": serialized.get("created_at"),
        "updated_at": serialized.get("updated_at"),
        "last_message_at": serialized.get("last_message_at"),
        "latest_triage": serialized.get("latest_triage"),
        "latest_entities": serialized.get("latest_entities"),
    }
