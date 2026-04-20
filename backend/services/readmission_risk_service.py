from __future__ import annotations

from datetime import timedelta
from typing import Any, Optional

from models.base import serialize_document, utc_now


def _top_factors(factors: list[str]) -> list[str]:
    cleaned: list[str] = []
    seen: set[str] = set()
    for factor in factors:
        normalized = " ".join((factor or "").split()).strip()
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        cleaned.append(normalized)
    return cleaned[:5]


def _summary(label: str, factors: list[str], window: str) -> str:
    key_factors = _top_factors(factors)
    if not key_factors:
        return f"{label} relapse risk. Continue routine follow-up in the next {window.lower()}."
    return f"{label} relapse risk because {'. '.join(key_factors[:2]).lower()}. Suggested review window: {window}."


def build_readmission_risk_snapshot(
    patient: Optional[dict[str, Any]],
    *,
    documents: Optional[list[dict[str, Any]]] = None,
    vitals: Optional[list[dict[str, Any]]] = None,
) -> dict[str, Any]:
    patient = patient or {}
    documents = documents or []
    vitals = vitals or []
    now = utc_now()

    triage_label = patient.get("triage_label") or patient.get("risk_level") or "Low"
    triage_score = int(patient.get("triage_score") or 0)
    deterioration_label = patient.get("deterioration_prediction_label") or "Low"
    deterioration_score = int(patient.get("deterioration_prediction_score") or 0)
    early_warning_priority = patient.get("early_warning_priority") or "Low"
    early_warning_score = int(patient.get("early_warning_score") or 0)
    clinical_alert_level = patient.get("clinical_alert_level") or "Low"
    medication_risk_level = patient.get("medication_risk_level") or "Low"
    appointments_requested = int(patient.get("appointments_requested") or 0)
    emergency_count = int(patient.get("emergency_count") or 0)
    missed_followup_count = int(patient.get("missed_followup_count") or 0)
    repeat_symptom_count = int(patient.get("repeat_symptom_count") or 0)
    visit_history = list(patient.get("visit_history") or [])
    worsening_flag = bool(patient.get("worsening_flag"))
    risk_trajectory = (patient.get("risk_trajectory") or "stable").lower()
    red_flags = list(patient.get("red_flags") or [])
    followup_priority = (patient.get("followup_priority") or "").lower()
    latest_vital = vitals[0] if vitals else {}
    latest_vital_severity = (latest_vital.get("severity") or patient.get("latest_vital_severity") or "").lower()

    lab_alert_levels = [(document.get("lab_alert_level") or "low").lower() for document in documents]
    discharge_risk_levels = [(document.get("discharge_risk_level") or "low").lower() for document in documents]
    high_abnormal_documents = [
        document
        for document in documents
        if (document.get("abnormal_value_count") or 0) > 0
        or (document.get("lab_alert_level") or "").lower() in {"high", "critical"}
        or (document.get("discharge_risk_level") or "").lower() in {"high", "critical"}
    ]

    score = 10
    factors: list[str] = []

    if triage_label == "Critical":
        score += 18
        factors.append("the current triage severity remains critical")
    elif triage_label == "High":
        score += 13
        factors.append("the current triage severity remains high")
    elif triage_label == "Medium":
        score += 7

    score += min(14, triage_score // 8)

    if deterioration_label == "Critical":
        score += 20
        factors.append("the deterioration model predicts critical near-term worsening")
    elif deterioration_label == "High":
        score += 14
        factors.append("the deterioration model predicts high near-term worsening")
    elif deterioration_label == "Medium":
        score += 8

    score += min(12, deterioration_score // 10)

    if early_warning_priority == "Critical":
        score += 16
        factors.append("the early-warning engine is already in a critical state")
    elif early_warning_priority == "High":
        score += 11
        factors.append("the early-warning engine remains elevated")
    elif early_warning_priority == "Medium":
        score += 6

    if early_warning_score >= 8:
        score += 4

    if clinical_alert_level in {"Critical", "High"}:
        score += 10
        factors.append("clinical safety alerts are still open")
    elif clinical_alert_level == "Medium":
        score += 5

    if medication_risk_level in {"Critical", "High"}:
        score += 8
        factors.append("medication reconciliation still contains elevated risk")
    elif medication_risk_level == "Medium":
        score += 4

    if worsening_flag:
        score += 10
        factors.append("the longitudinal symptom trend is worsening")

    if risk_trajectory == "critical":
        score += 10
    elif risk_trajectory == "rising":
        score += 7
        factors.append("risk trajectory has risen across recent encounters")

    if repeat_symptom_count >= 2:
        score += min(10, repeat_symptom_count * 2)
        factors.append("symptoms are recurring across multiple interactions")

    if emergency_count > 0:
        score += min(12, emergency_count * 5)
        factors.append("the patient has recent emergency activity in the same care journey")

    if missed_followup_count > 0:
        score += min(10, missed_followup_count * 4)
        factors.append("follow-up adherence has already been missed")

    if appointments_requested > 0 and followup_priority not in {"", "routine follow-up"}:
        score += 6
        factors.append("there is still an unresolved follow-up or scheduling priority")

    if latest_vital_severity == "critical":
        score += 12
        factors.append("latest bedside vitals remain critically abnormal")
    elif latest_vital_severity == "high":
        score += 8
        factors.append("latest bedside vitals remain high risk")
    elif latest_vital_severity == "medium":
        score += 4

    if "critical" in lab_alert_levels or "high" in lab_alert_levels:
        score += 10
        factors.append("lab reports include abnormal values that may require re-evaluation")
    elif "medium" in lab_alert_levels:
        score += 5

    if "critical" in discharge_risk_levels or "high" in discharge_risk_levels:
        score += 11
        factors.append("discharge documentation includes elevated return-risk instructions")
    elif "medium" in discharge_risk_levels:
        score += 5

    if len(high_abnormal_documents) >= 2:
        score += 4

    if len(visit_history) >= 2:
        score += 8
        factors.append("multiple prior completed visits suggest a recurrent or unresolved issue")
    elif len(visit_history) == 1:
        score += 4

    if len(red_flags) >= 2:
        score += 6
        factors.append("red-flag symptoms are still present in the patient record")
    elif len(red_flags) == 1:
        score += 3

    score = max(0, min(100, score))

    if score >= 85:
        label = "Critical"
        window = "Immediate 24-hour review"
        next_check_at = now + timedelta(hours=24)
    elif score >= 60:
        label = "High"
        window = "48-hour follow-up"
        next_check_at = now + timedelta(hours=48)
    elif score >= 35:
        label = "Medium"
        window = "7-day follow-up"
        next_check_at = now + timedelta(days=7)
    else:
        label = "Low"
        window = "Routine 14-day follow-up"
        next_check_at = now + timedelta(days=14)

    top_factors = _top_factors(factors)
    return {
        "readmission_risk_score": score,
        "readmission_risk_label": label,
        "readmission_risk_summary": _summary(label, top_factors, window),
        "readmission_risk_factors": top_factors,
        "relapse_risk_window": window,
        "readmission_next_check_at": next_check_at,
        "readmission_prediction_updated_at": now,
    }


def enrich_patient_with_readmission_risk(
    patient: Optional[dict[str, Any]],
    *,
    documents: Optional[list[dict[str, Any]]] = None,
    vitals: Optional[list[dict[str, Any]]] = None,
) -> Optional[dict[str, Any]]:
    if not patient:
        return None

    score = patient.get("readmission_risk_score")
    label = patient.get("readmission_risk_label")
    summary = patient.get("readmission_risk_summary")
    window = patient.get("relapse_risk_window")
    if score not in (None, 0) and label and summary and window:
        return patient

    derived = build_readmission_risk_snapshot(patient, documents=documents, vitals=vitals)
    return serialize_document({**patient, **derived}) or patient
