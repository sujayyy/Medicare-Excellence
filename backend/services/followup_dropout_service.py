from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from models.base import serialize_document, utc_now


def _parse_datetime(value: Any) -> Optional[datetime]:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


def _factors(values: list[str]) -> list[str]:
    cleaned: list[str] = []
    seen: set[str] = set()
    for value in values:
        normalized = " ".join((value or "").split()).strip()
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        cleaned.append(normalized)
    return cleaned[:5]


def _summary(label: str, factors: list[str], window: str) -> str:
    highlights = _factors(factors)
    if not highlights:
        return f"{label} follow-up dropout risk. Continue standard reminders before the next scheduled review."
    return f"{label} follow-up dropout risk because {'. '.join(highlights[:2]).lower()}. Suggested outreach window: {window}."


def build_followup_dropout_snapshot(patient: Optional[dict[str, Any]]) -> dict[str, Any]:
    patient = patient or {}
    now = utc_now()

    followup_due_at = _parse_datetime(patient.get("followup_due_at"))
    last_engagement_at = _parse_datetime(patient.get("last_engagement_at") or patient.get("last_interaction_at"))
    appointments_requested = int(patient.get("appointments_requested") or 0)
    missed_followup_count = int(patient.get("missed_followup_count") or 0)
    appointment_risk_label = patient.get("appointment_risk_label") or "Low"
    appointment_risk_score = int(patient.get("appointment_risk_score") or 0)
    deterioration_label = patient.get("deterioration_prediction_label") or "Low"
    readmission_label = patient.get("readmission_risk_label") or "Low"
    early_warning_priority = patient.get("early_warning_priority") or "Low"
    risk_trajectory = (patient.get("risk_trajectory") or "stable").lower()
    worsening_flag = bool(patient.get("worsening_flag"))
    status = (patient.get("status") or "").lower()
    followup_priority = (patient.get("followup_priority") or "").lower()

    score = 12
    factors: list[str] = []

    if followup_due_at:
        overdue_hours = (now - followup_due_at).total_seconds() / 3600
        if overdue_hours >= 72:
            score += 26
            factors.append("the recommended follow-up window is already more than 72 hours overdue")
        elif overdue_hours >= 24:
            score += 18
            factors.append("the recommended follow-up window is already overdue")
        elif overdue_hours >= 0:
            score += 10
            factors.append("the follow-up due time has started without confirmed re-engagement")
    elif appointments_requested > 0:
        score += 8

    if last_engagement_at:
        silence_hours = (now - last_engagement_at).total_seconds() / 3600
        if silence_hours >= 168:
            score += 20
            factors.append("there has been no patient engagement for at least a week")
        elif silence_hours >= 72:
            score += 12
            factors.append("recent patient engagement has gone quiet for multiple days")
        elif silence_hours >= 24 and followup_due_at and followup_due_at <= now:
            score += 8
    elif appointments_requested > 0:
        score += 10
        factors.append("there is an active care need but no engagement timestamp is available")

    if missed_followup_count > 0:
        score += min(20, missed_followup_count * 6)
        factors.append("follow-up adherence has already been missed in this patient journey")

    if appointments_requested > 0:
        score += min(10, appointments_requested * 3)
        if "appointment" in status or "intake" in status:
            factors.append("there is an unresolved appointment or intake step still waiting")

    if appointment_risk_label in {"Critical", "High"}:
        score += 12
        factors.append("the scheduling risk model already marks this patient as high priority")
    elif appointment_risk_label == "Medium":
        score += 7
    score += min(8, appointment_risk_score // 15)

    if deterioration_label in {"Critical", "High"}:
        score += 10
        factors.append("near-term deterioration risk is high while follow-up remains open")
    elif deterioration_label == "Medium":
        score += 5

    if readmission_label in {"Critical", "High"}:
        score += 10
        factors.append("return-risk is high if the patient drops out of care now")
    elif readmission_label == "Medium":
        score += 5

    if early_warning_priority in {"Critical", "High"}:
        score += 8
        factors.append("early-warning signals are elevated, making missed follow-up more dangerous")
    elif early_warning_priority == "Medium":
        score += 4

    if worsening_flag:
        score += 8
        factors.append("symptoms are worsening while follow-up is still pending")

    if risk_trajectory in {"rising", "critical"}:
        score += 6

    if "routine" not in followup_priority and followup_priority:
        score += 6
        factors.append("the care plan already asks for faster follow-up than routine")

    score = max(0, min(100, score))

    if score >= 85:
        label = "Critical"
        outreach_window = "Immediate outreach today"
        next_touch = now + timedelta(hours=2)
    elif score >= 60:
        label = "High"
        outreach_window = "Outreach within 24 hours"
        next_touch = now + timedelta(hours=24)
    elif score >= 35:
        label = "Medium"
        outreach_window = "Outreach within 72 hours"
        next_touch = now + timedelta(hours=72)
    else:
        label = "Low"
        outreach_window = "Routine reminder within 7 days"
        next_touch = now + timedelta(days=7)

    risk_factors = _factors(factors)
    return {
        "followup_dropout_risk_score": score,
        "followup_dropout_risk_label": label,
        "followup_dropout_risk_summary": _summary(label, risk_factors, outreach_window),
        "followup_dropout_risk_factors": risk_factors,
        "followup_outreach_window": outreach_window,
        "followup_next_touch_at": next_touch,
        "followup_dropout_updated_at": now,
    }


def enrich_patient_with_followup_dropout_risk(patient: Optional[dict[str, Any]]) -> Optional[dict[str, Any]]:
    if not patient:
        return None

    score = patient.get("followup_dropout_risk_score")
    label = patient.get("followup_dropout_risk_label")
    summary = patient.get("followup_dropout_risk_summary")
    window = patient.get("followup_outreach_window")
    if score not in (None, 0) and label and summary and window:
        return patient

    derived = build_followup_dropout_snapshot(patient)
    return serialize_document({**patient, **derived}) or patient
