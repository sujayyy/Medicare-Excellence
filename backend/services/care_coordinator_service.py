from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from models.base import serialize_document


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


def _priority(score: int) -> str:
    if score >= 85:
        return "Critical"
    if score >= 60:
        return "High"
    if score >= 35:
        return "Medium"
    return "Low"


def _task_window(score: int, now: datetime) -> tuple[str, datetime]:
    if score >= 85:
        return "Immediate today", now + timedelta(hours=2)
    if score >= 60:
        return "Within 24 hours", now + timedelta(hours=24)
    if score >= 35:
        return "Within 72 hours", now + timedelta(hours=72)
    return "Routine within 7 days", now + timedelta(days=7)


def _task_for_patient(patient: dict[str, Any], *, now: datetime) -> Optional[dict[str, Any]]:
    readmission_score = int(patient.get("readmission_risk_score") or 0)
    dropout_score = int(patient.get("followup_dropout_risk_score") or 0)
    deterioration_score = int(patient.get("deterioration_prediction_score") or 0)
    early_warning_score = int(patient.get("early_warning_score") or 0)
    appointment_score = int(patient.get("appointment_risk_score") or 0)
    medication_risk = (patient.get("medication_risk_level") or "Low").lower()
    clinical_alert = (patient.get("clinical_alert_level") or "Low").lower()
    triage_label = patient.get("triage_label") or patient.get("risk_level") or "Low"
    missed_followups = int(patient.get("missed_followup_count") or 0)
    worsening_flag = bool(patient.get("worsening_flag"))
    due_at = _parse_datetime(patient.get("followup_due_at"))
    symptoms = list(patient.get("symptoms") or [])
    workflow_status = (patient.get("care_coordinator_status") or "open").lower()
    workflow_note = patient.get("care_coordinator_note") or ""
    workflow_history = list(patient.get("care_coordinator_history") or [])

    base_score = max(readmission_score, dropout_score, deterioration_score, appointment_score)
    score = base_score
    reasons: list[str] = []
    action_type = "routine_followup"

    if dropout_score >= 60:
        action_type = "dropout_outreach"
        reasons.append("follow-up adherence risk is elevated")
        score += 8
    if readmission_score >= 60:
        action_type = "return_prevention"
        reasons.append("relapse or readmission risk is elevated")
        score += 6
    if deterioration_score >= 60 or triage_label in {"High", "Critical"}:
        action_type = "clinician_callback"
        reasons.append("clinical worsening risk is elevated")
        score += 8
    if early_warning_score >= 8:
        action_type = "urgent_monitoring"
        reasons.append("early-warning signals need close monitoring")
        score += 8
    if medication_risk in {"high", "critical"} or clinical_alert in {"high", "critical"}:
        action_type = "safety_reconciliation"
        reasons.append("safety review and medication reconciliation remain open")
        score += 6
    if missed_followups > 0:
        reasons.append("the patient has already missed follow-up in this care journey")
        score += min(10, missed_followups * 3)
    if worsening_flag:
        reasons.append("the symptom trend is worsening")
        score += 5
    if due_at and due_at <= now:
        reasons.append("the follow-up due time is already overdue")
        score += 8

    if workflow_status == "resolved" and score < 85:
        return None
    if workflow_status in {"contacted", "rescheduled", "monitoring"}:
        score = max(0, score - 8)
    elif workflow_status == "no_response":
        score += 6
        reasons.append("outreach has already failed to reach the patient once")
    elif workflow_status == "escalated":
        score += 10
        reasons.append("the coordination task has already been escalated")

    if score < 30 and appointment_score < 35 and readmission_score < 35 and dropout_score < 35:
        return None

    priority = _priority(min(score, 100))
    outreach_window, next_action_at = _task_window(min(score, 100), now)
    summary = f"{patient.get('name') or 'Patient'} needs {action_type.replace('_', ' ')} because {', '.join(reasons[:2]) or 'risk follow-up is pending'}."

    return {
        "patient_id": patient.get("id"),
        "patient_name": patient.get("name") or "Patient",
        "patient_email": patient.get("email") or "",
        "assigned_doctor_name": patient.get("assigned_doctor_name") or "",
        "priority": priority,
        "task_type": action_type,
        "score": min(score, 100),
        "summary": summary,
        "reason_factors": reasons[:4],
        "suggested_action": (
            "Escalate to clinician today."
            if priority == "Critical"
            else "Send outreach and confirm next follow-up."
            if priority == "High"
            else "Queue reminder and monitor re-engagement."
        ),
        "outreach_window": outreach_window,
        "next_action_at": next_action_at,
        "symptom_snapshot": symptoms[:3],
        "followup_priority": patient.get("followup_priority") or "Routine follow-up",
        "workflow": {
            "status": workflow_status,
            "note": workflow_note,
            "updated_at": patient.get("care_coordinator_updated_at"),
            "updated_by": patient.get("care_coordinator_updated_by") or "",
            "history": workflow_history[:5],
        },
        "outreach_history": list(patient.get("care_outreach_history") or [])[:5],
    }


def build_care_coordinator_queue(patients: list[dict[str, Any]]) -> dict[str, Any]:
    now = datetime.now(timezone.utc)
    queue = [
        task
        for patient in patients
        for task in [_task_for_patient(patient, now=now)]
        if task
    ]
    queue.sort(key=lambda item: (item.get("score") or 0, item.get("priority") == "Critical"), reverse=True)
    serialized_queue = [serialize_document(item) or item for item in queue[:8]]
    summary = {
        "critical": len([item for item in serialized_queue if item["priority"] == "Critical"]),
        "high": len([item for item in serialized_queue if item["priority"] == "High"]),
        "medium": len([item for item in serialized_queue if item["priority"] == "Medium"]),
        "low": len([item for item in serialized_queue if item["priority"] == "Low"]),
    }
    return {
        "care_coordinator_summary": summary,
        "care_coordinator_queue": serialized_queue,
    }
