from datetime import timedelta
from typing import Any, Optional

from models.base import serialize_document, utc_now


def _reason(parts: list[str]) -> str:
    cleaned = [part for part in parts if part]
    if not cleaned:
        return "No strong near-term deterioration signal is visible from the current record."
    return ". ".join(cleaned[:3]) + "."


def build_deterioration_prediction(
    *,
    previous_patient: Optional[dict[str, Any]],
    triage: dict[str, Any],
    entities: dict[str, Any],
    current_status: str,
    deterioration: Optional[dict[str, Any]] = None,
    appointment_risk: Optional[dict[str, Any]] = None,
) -> dict[str, Any]:
    previous_patient = previous_patient or {}
    deterioration = deterioration or {}
    appointment_risk = appointment_risk or {}
    now = utc_now()

    triage_score = int(triage.get("triage_score") or 0)
    triage_label = triage.get("triage_label") or previous_patient.get("triage_label") or "Low"
    emergency_count = int(previous_patient.get("emergency_count") or 0)
    appointments_requested = int(previous_patient.get("appointments_requested") or 0)
    repeat_symptom_count = int(
        deterioration.get("repeat_symptom_count")
        or previous_patient.get("repeat_symptom_count")
        or 0
    )
    worsening_flag = bool(deterioration.get("worsening_flag") or previous_patient.get("worsening_flag"))
    risk_trajectory = (
        deterioration.get("risk_trajectory") or previous_patient.get("risk_trajectory") or "stable"
    ).lower()
    red_flags = entities.get("red_flags") or previous_patient.get("red_flags") or []
    visit_history = previous_patient.get("visit_history") or []
    latest_vital_severity = (previous_patient.get("latest_vital_severity") or "").lower()
    appointment_risk_score = int(
        appointment_risk.get("appointment_risk_score")
        or previous_patient.get("appointment_risk_score")
        or 0
    )
    status = (current_status or previous_patient.get("status") or "Monitoring").lower()

    score = 12
    reasons: list[str] = []

    if triage_label == "Critical":
        score += 42
        reasons.append("Critical triage suggests likely deterioration without fast intervention")
    elif triage_label == "High":
        score += 28
        reasons.append("High-risk symptoms raise the chance of near-term worsening")
    elif triage_label == "Medium":
        score += 16
    else:
        score += 6

    score += min(18, triage_score // 6)

    if worsening_flag:
        score += 18
        reasons.append("The patient already shows a worsening trajectory")

    if risk_trajectory == "critical":
        score += 20
    elif risk_trajectory == "rising":
        score += 12
        reasons.append("Risk has risen across recent interactions")

    if repeat_symptom_count >= 2:
        score += min(14, (repeat_symptom_count - 1) * 4)
        reasons.append("Symptoms are recurring across multiple chats")

    if emergency_count > 0 or "emergency reported" in status:
        score += 14
        reasons.append("Recent emergency activity increases short-term deterioration risk")

    if latest_vital_severity == "critical":
        score += 18
        reasons.append("Latest bedside vitals are critically abnormal")
    elif latest_vital_severity == "high":
        score += 12
        reasons.append("Latest bedside vitals remain high risk")
    elif latest_vital_severity == "medium":
        score += 6

    if len(visit_history) >= 3:
        score += 6
        reasons.append("Multiple prior visits suggest an unresolved or recurring clinical course")

    if appointments_requested > 0 and appointment_risk_score >= 60:
        score += 10
        reasons.append("An urgent scheduling need is still unresolved")

    if red_flags:
        score += min(16, len(red_flags) * 5)
        reasons.append("Red-flag symptoms are present in the current record")

    if "appointment intake pending" in status:
        score += 8
    elif "appointment requested" in status:
        score += 6

    score = max(0, min(100, score))

    if score >= 85:
        label = "Critical"
        followup_window = "Immediate review"
        next_check_at = now + timedelta(hours=1)
    elif score >= 60:
        label = "High"
        followup_window = "Within 6 hours"
        next_check_at = now + timedelta(hours=6)
    elif score >= 35:
        label = "Medium"
        followup_window = "Within 24 hours"
        next_check_at = now + timedelta(hours=24)
    else:
        label = "Low"
        followup_window = "Routine 72-hour review"
        next_check_at = now + timedelta(hours=72)

    return {
        "deterioration_prediction_score": score,
        "deterioration_prediction_label": label,
        "deterioration_prediction_reason": _reason(reasons),
        "predicted_followup_window": followup_window,
        "prediction_next_check_at": next_check_at,
        "prediction_updated_at": now,
    }


def enrich_deterioration_prediction(patient: Optional[dict[str, Any]]) -> Optional[dict[str, Any]]:
    if not patient:
        return None

    score = patient.get("deterioration_prediction_score")
    label = patient.get("deterioration_prediction_label")
    reason = patient.get("deterioration_prediction_reason")
    window = patient.get("predicted_followup_window")
    if score not in (None, 0) and label and reason and window:
        return patient

    derived = build_deterioration_prediction(
        previous_patient=patient,
        triage={
            "triage_score": patient.get("triage_score") or 0,
            "triage_label": patient.get("triage_label") or patient.get("risk_level") or "Low",
        },
        entities={
            "red_flags": patient.get("red_flags") or [],
        },
        current_status=patient.get("status") or "Monitoring",
        deterioration={
            "worsening_flag": patient.get("worsening_flag"),
            "risk_trajectory": patient.get("risk_trajectory"),
            "repeat_symptom_count": patient.get("repeat_symptom_count"),
        },
        appointment_risk={
            "appointment_risk_score": patient.get("appointment_risk_score"),
        },
    )
    return serialize_document({**patient, **derived}) or patient
