from __future__ import annotations

import os
from datetime import datetime, timezone
from urllib.parse import quote

from models.base import serialize_document


def _clean_phone(value: str) -> str:
    return "".join(character for character in str(value or "") if character.isdigit())


def _build_message(patient: dict, *, channel: str) -> str:
    name = patient.get("name") or "Patient"
    followup_priority = patient.get("followup_priority") or "follow-up review"
    followup_window = patient.get("followup_outreach_window") or patient.get("relapse_risk_window") or "the next scheduled review"
    symptom_snapshot = ", ".join((patient.get("symptoms") or [])[:3]) or "your recent care plan"

    if channel == "whatsapp":
        return (
            f"Hello {name}, this is a care-team reminder from Medicare Excellence. "
            f"Please respond regarding {followup_priority.lower()} for {symptom_snapshot}. "
            f"Suggested action window: {followup_window}."
        )
    if channel == "email":
        return (
            f"Hello {name},\n\n"
            f"Our care team is checking in about {followup_priority.lower()} for {symptom_snapshot}.\n"
            f"Suggested action window: {followup_window}.\n\n"
            "Please reply or contact the hospital care desk if you need help.\n"
        )
    return (
        f"Care-team follow-up call reminder for {name}: discuss {followup_priority.lower()} and confirm next step within {followup_window}."
    )


def create_care_outreach_attempt(patient: dict, *, channel: str, actor: dict) -> dict:
    now = datetime.now(timezone.utc)
    channel = str(channel or "").strip().lower()
    if channel not in {"email", "whatsapp", "phone"}:
        raise ValueError("Unsupported outreach channel.")

    message = _build_message(patient, channel=channel)
    attempt = {
        "channel": channel,
        "status": "logged",
        "message_preview": message[:320],
        "actor_name": actor.get("name") or "Care team",
        "actor_role": actor.get("role") or "",
        "actor_user_id": str(actor.get("_id") or ""),
        "created_at": now,
    }

    if channel == "email":
        email = str(patient.get("email") or "").strip()
        if not email:
            raise ValueError("This patient does not have an email address on file.")
        subject = quote("Care Follow-up Reminder")
        body = quote(message)
        attempt["status"] = "preview_ready"
        attempt["target"] = email
        attempt["preview_url"] = f"mailto:{email}?subject={subject}&body={body}"
        if os.getenv("SMTP_HOST", "").strip():
            attempt["status"] = "queued"
    elif channel == "whatsapp":
        phone = _clean_phone(patient.get("phone") or "")
        if not phone:
            raise ValueError("This patient does not have a phone number on file.")
        attempt["status"] = "handoff_ready"
        attempt["target"] = phone
        attempt["preview_url"] = f"https://wa.me/{phone}?text={quote(message)}"
    else:
        phone = _clean_phone(patient.get("phone") or "")
        attempt["status"] = "call_logged"
        attempt["target"] = phone or "manual call"

    return serialize_document(attempt) or attempt
