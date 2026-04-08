from datetime import timedelta
from typing import Any, Optional

from models.base import utc_now


def _build_reason(parts: list[str]) -> str:
    cleaned = [part for part in parts if part]
    if not cleaned:
        return "No urgent scheduling risk was detected in the latest patient activity."
    return ". ".join(cleaned[:3]) + "."


def build_appointment_risk_profile(
    *,
    previous_patient: Optional[dict[str, Any]],
    triage: dict[str, Any],
    entities: dict[str, Any],
    current_status: str,
    deterioration: Optional[dict[str, Any]] = None,
) -> dict[str, Any]:
    previous_patient = previous_patient or {}
    deterioration = deterioration or {}
    now = utc_now()

    triage_score = int(triage.get("triage_score") or 0)
    triage_label = triage.get("triage_label") or "Low"
    appointments_requested = int(previous_patient.get("appointments_requested") or 0)
    emergency_count = int(previous_patient.get("emergency_count") or 0)
    repeat_symptom_count = int(
        deterioration.get("repeat_symptom_count")
        or previous_patient.get("repeat_symptom_count")
        or 0
    )
    worsening_flag = bool(deterioration.get("worsening_flag") or previous_patient.get("worsening_flag"))
    risk_trajectory = (
        deterioration.get("risk_trajectory") or previous_patient.get("risk_trajectory") or "stable"
    ).lower()
    red_flags = entities.get("red_flags") or []
    status = (current_status or "").lower()

    score = 10
    reasons: list[str] = []

    if triage_label == "Critical":
        score += 40
        reasons.append("Critical symptoms need immediate scheduling review")
    elif triage_label == "High":
        score += 28
        reasons.append("High-risk symptoms should be escalated quickly")
    elif triage_label == "Medium":
        score += 16
        reasons.append("Active symptoms should not wait too long for follow-up")
    else:
        score += 6

    score += min(20, triage_score // 5)

    if "appointment requested" in status:
        score += 20
        reasons.append("An appointment request is already waiting for action")
    elif "intake pending" in status:
        score += 14
        reasons.append("Appointment intake details are still incomplete")
    elif appointments_requested > 0:
        score += 10
        reasons.append("There is already a recent follow-up request on file")

    if worsening_flag:
        score += 16
        reasons.append("Symptoms appear to be worsening")

    if risk_trajectory == "critical":
        score += 18
    elif risk_trajectory == "rising":
        score += 12
        reasons.append("Risk is rising compared with earlier chats")

    if repeat_symptom_count >= 2:
        score += min(14, (repeat_symptom_count - 1) * 4)
        reasons.append("Symptoms have recurred across multiple interactions")

    if emergency_count > 0 or "emergency reported" in status:
        score += 15
        reasons.append("Recent emergency activity increases follow-up urgency")

    if red_flags:
        score += min(12, len(red_flags) * 4)
        reasons.append("Red-flag symptoms were extracted from the latest message")

    score = max(0, min(100, score))

    if score >= 85:
        label = "Critical"
        priority = "Immediate review"
        due_at = now + timedelta(hours=1)
    elif score >= 60:
        label = "High"
        priority = "Schedule today"
        due_at = now + timedelta(hours=4)
    elif score >= 35:
        label = "Medium"
        priority = "Book within 24 hours"
        due_at = now + timedelta(hours=24)
    else:
        label = "Low"
        priority = "Routine follow-up"
        due_at = now + timedelta(hours=72)

    return {
        "appointment_risk_score": score,
        "appointment_risk_label": label,
        "appointment_risk_reason": _build_reason(reasons),
        "followup_priority": priority,
        "followup_due_at": due_at,
        "appointment_risk_updated_at": now,
    }
