from __future__ import annotations

from typing import Any

from models.base import utc_now


def _to_float(value: Any) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _raise_label(current: str, incoming: str) -> str:
    order = {"Low": 1, "Medium": 2, "High": 3, "Critical": 4}
    return incoming if order.get(incoming, 1) > order.get(current, 1) else current


def build_early_warning_snapshot(
    patient: dict[str, Any] | None,
    *,
    vitals: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    patient = patient or {}
    latest_vital = (vitals or [None])[0] or {}

    score = 0
    priority = "Low"
    components: list[str] = []

    spo2 = _to_float(latest_vital.get("spo2"))
    if spo2 is not None:
        if spo2 < 90:
            score += 4
            priority = _raise_label(priority, "Critical")
            components.append(f"SpO2 is {spo2:.0f}%, which is critically low.")
        elif spo2 < 94:
            score += 3
            priority = _raise_label(priority, "High")
            components.append(f"SpO2 is {spo2:.0f}%, below the expected range.")

    pulse = _to_float(latest_vital.get("pulse"))
    if pulse is not None:
        if pulse >= 130 or pulse <= 40:
            score += 3
            priority = _raise_label(priority, "High")
            components.append(f"Pulse is {pulse:.0f}, which needs urgent review.")
        elif pulse >= 110 or pulse <= 50:
            score += 2
            priority = _raise_label(priority, "Medium")
            components.append(f"Pulse is {pulse:.0f}, outside the routine range.")

    temperature = _to_float(latest_vital.get("temperature"))
    if temperature is not None:
        if temperature >= 103 or temperature <= 95:
            score += 2
            priority = _raise_label(priority, "High")
            components.append(f"Temperature is {temperature:.1f}, which is clinically significant.")
        elif temperature >= 100.4:
            score += 1
            priority = _raise_label(priority, "Medium")
            components.append(f"Temperature is {temperature:.1f}, showing active fever.")

    systolic = _to_float(latest_vital.get("systolic_bp"))
    diastolic = _to_float(latest_vital.get("diastolic_bp"))
    if systolic is not None and diastolic is not None:
        if systolic >= 180 or diastolic >= 120 or systolic <= 85:
            score += 3
            priority = _raise_label(priority, "High")
            components.append(f"Blood pressure is {int(systolic)}/{int(diastolic)}, which needs urgent reassessment.")
        elif systolic >= 160 or diastolic >= 100:
            score += 2
            priority = _raise_label(priority, "Medium")
            components.append(f"Blood pressure is {int(systolic)}/{int(diastolic)}, above target range.")

    triage_label = patient.get("triage_label") or patient.get("risk_level") or "Low"
    if triage_label == "Critical":
        score += 4
        priority = _raise_label(priority, "Critical")
        components.append("AI triage remains critical.")
    elif triage_label == "High":
        score += 3
        priority = _raise_label(priority, "High")
        components.append("AI triage remains high risk.")
    elif triage_label == "Medium":
        score += 1
        priority = _raise_label(priority, "Medium")

    deterioration_label = patient.get("deterioration_prediction_label") or "Low"
    if deterioration_label == "Critical":
        score += 3
        priority = _raise_label(priority, "Critical")
        components.append("Longitudinal deterioration model predicts critical short-term worsening.")
    elif deterioration_label == "High":
        score += 2
        priority = _raise_label(priority, "High")
        components.append("Longitudinal deterioration model predicts near-term worsening.")
    elif patient.get("worsening_flag"):
        score += 2
        priority = _raise_label(priority, "High")
        components.append("Trend analysis marks the patient as worsening.")

    clinical_alert_level = patient.get("clinical_alert_level") or "Low"
    if clinical_alert_level == "Critical":
        score += 2
        priority = _raise_label(priority, "Critical")
    elif clinical_alert_level == "High":
        score += 1
        priority = _raise_label(priority, "High")

    red_flags = patient.get("red_flags") or []
    if len(red_flags) >= 2:
        score += 1
        priority = _raise_label(priority, "High")
        components.append("Multiple red-flag symptoms are active.")

    if not latest_vital and triage_label in {"High", "Critical"}:
        score += 2
        priority = _raise_label(priority, "High")
        components.append("Fresh vitals are missing despite a high-acuity presentation.")

    score = max(0, min(score, 12))

    if priority == "Critical" or score >= 9:
        priority = "Critical"
        response = "Immediate bedside review and escalation now."
        monitoring_window = "Repeat vitals now"
    elif priority == "High" or score >= 6:
        priority = "High"
        response = "Urgent clinician review with repeat vitals within 15 minutes."
        monitoring_window = "15-minute reassessment"
    elif priority == "Medium" or score >= 3:
        priority = "Medium"
        response = "Close observation with repeat vitals within 30 to 60 minutes."
        monitoring_window = "30-60 minute reassessment"
    else:
        priority = "Low"
        response = "Routine monitoring is appropriate unless symptoms worsen."
        monitoring_window = "Routine observation"

    summary = components[0] if components else "No strong early-warning trigger is active from the current record."

    return {
        "early_warning_score": score,
        "early_warning_priority": priority,
        "early_warning_summary": summary,
        "early_warning_response": response,
        "early_warning_monitoring_window": monitoring_window,
        "early_warning_components": components[:5],
        "early_warning_updated_at": utc_now(),
    }


def enrich_patient_with_early_warning(patient: dict[str, Any], *, vitals: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    return {
        **patient,
        **build_early_warning_snapshot(patient, vitals=vitals),
    }
