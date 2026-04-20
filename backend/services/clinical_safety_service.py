from __future__ import annotations

from typing import Any

from models.base import utc_now
from models.document_model import list_documents
from models.vital_model import list_vitals
from services.medication_risk_service import build_medication_risk_snapshot


SEVERITY_ORDER = {
    "low": 1,
    "medium": 2,
    "high": 3,
    "critical": 4,
}

NSAID_HINTS = {"ibuprofen", "diclofenac", "naproxen", "aceclofenac", "ketorolac"}
ANTIBIOTIC_HINTS = {"amoxicillin", "azithromycin", "cef", "clav", "doxy", "cipro", "antibiotic"}
STEROID_HINTS = {"prednisolone", "methylpred", "dexa", "hydrocortisone", "steroid"}


def _severity_value(level: str) -> int:
    return SEVERITY_ORDER.get((level or "low").lower(), 1)


def _raise_level(current: str, incoming: str) -> str:
    return incoming if _severity_value(incoming) > _severity_value(current) else current


def _clean(value: Any) -> str:
    return " ".join(str(value or "").split()).strip()


def _compact(values: list[str], fallback: str) -> str:
    cleaned = [_clean(value) for value in values if _clean(value)]
    if not cleaned:
        return fallback
    if len(cleaned) == 1:
        return cleaned[0]
    if len(cleaned) == 2:
        return f"{cleaned[0]} and {cleaned[1]}"
    return f"{', '.join(cleaned[:-1])}, and {cleaned[-1]}"


def _current_medications(documents: list[dict[str, Any]]) -> list[dict[str, Any]]:
    entries: list[dict[str, Any]] = []
    for document in documents:
        if document.get("document_type") != "prescription":
            continue
        for medication in document.get("medication_schedule") or []:
            if medication.get("drug_name"):
                entries.append(medication)
    return entries


def _build_vital_risk_flags(patient: dict[str, Any], vitals: list[dict[str, Any]]) -> tuple[list[str], str]:
    flags: list[str] = []
    severity = "low"

    latest = vitals[0] if vitals else None
    if not latest:
        if (patient.get("triage_label") or "Low") in {"High", "Critical"}:
            flags.append("High-acuity case does not yet have fresh bedside vitals recorded.")
            severity = "high"
        return flags, severity

    vital_severity = (latest.get("severity") or "normal").lower()
    if vital_severity in {"high", "critical"}:
        flags.append(latest.get("summary") or "Latest vitals show abnormal values that need review.")
        severity = _raise_level(severity, "critical" if vital_severity == "critical" else "high")

    try:
        spo2 = float(latest.get("spo2"))
        if spo2 < 94:
            flags.append(f"SpO2 is {spo2:.0f}% and may indicate respiratory compromise.")
            severity = _raise_level(severity, "critical" if spo2 < 90 else "high")
    except (TypeError, ValueError):
        pass

    try:
        systolic = float(latest.get("systolic_bp"))
        diastolic = float(latest.get("diastolic_bp"))
        if systolic >= 180 or diastolic >= 120:
            flags.append(f"Blood pressure is {int(systolic)}/{int(diastolic)}, which is in crisis range.")
            severity = _raise_level(severity, "critical")
        elif systolic >= 140 or diastolic >= 90:
            flags.append(f"Blood pressure is {int(systolic)}/{int(diastolic)} and remains above target range.")
            severity = _raise_level(severity, "medium")
    except (TypeError, ValueError):
        pass

    try:
        glucose = float(latest.get("glucose"))
        if glucose >= 250 or glucose <= 60:
            flags.append(f"Glucose is {int(glucose)}, which needs urgent medication and hydration review.")
            severity = _raise_level(severity, "high")
    except (TypeError, ValueError):
        pass

    return flags[:4], severity


def _build_drug_risk_flags(patient: dict[str, Any], medications: list[dict[str, Any]]) -> tuple[list[str], str]:
    flags: list[str] = []
    severity = "low"

    names = [_clean(entry.get("drug_name")).lower() for entry in medications if _clean(entry.get("drug_name"))]
    unique_names = {name for name in names if name}
    if len(unique_names) != len(names):
        flags.append("Possible duplicate or repeated medicines were detected in the current prescription list.")
        severity = _raise_level(severity, "medium")

    if any(not _clean(entry.get("dosage")) or _clean(entry.get("dosage")).lower() == "not specified" for entry in medications):
        flags.append("One or more medicines are missing a clear dosage and should be manually confirmed.")
        severity = _raise_level(severity, "medium")

    if any(not _clean(entry.get("timing")) or "follow clinician instructions" in _clean(entry.get("timing")).lower() for entry in medications):
        flags.append("One or more medicines are missing a clear timing schedule for the patient.")
        severity = _raise_level(severity, "medium")

    if any(any(hint in name for hint in ANTIBIOTIC_HINTS) for name in unique_names):
        flags.append("Antibiotic therapy is present, so indication, duration, and completion counseling should be verified.")
        severity = _raise_level(severity, "medium")

    blood_pressure_text = _clean(patient.get("latest_vital_summary")).lower()
    if any(any(hint in name for hint in NSAID_HINTS) for name in unique_names) and ("blood pressure" in blood_pressure_text or "high blood pressure" in blood_pressure_text):
        flags.append("NSAID therapy appears alongside elevated blood-pressure history and deserves clinician review.")
        severity = _raise_level(severity, "high")

    glucose_text = _clean(patient.get("latest_vital_summary")).lower()
    if any(any(hint in name for hint in STEROID_HINTS) for name in unique_names) and ("glucose" in glucose_text or "sugar" in glucose_text):
        flags.append("Steroid therapy appears in a patient with glucose concerns and may need monitoring advice.")
        severity = _raise_level(severity, "medium")

    chest_pain_text = " ".join(
        [
            _clean(patient.get("last_summary")).lower(),
            " ".join(str(item).lower() for item in patient.get("symptoms") or []),
            " ".join(str(item).lower() for item in patient.get("red_flags") or []),
        ]
    )
    if ("chest pain" in chest_pain_text or "left arm" in chest_pain_text) and any("paracetamol" in name or "acetaminophen" in name for name in unique_names):
        flags.append("Pain-relief medication should not delay escalation when cardiac-style symptoms remain active.")
        severity = _raise_level(severity, "high")

    return flags[:4], severity


def _build_condition_risk_flags(patient: dict[str, Any], vitals: list[dict[str, Any]]) -> tuple[list[str], str]:
    flags: list[str] = []
    severity = "low"

    triage_label = patient.get("triage_label") or patient.get("risk_level") or "Low"
    if triage_label in {"High", "Critical"}:
        flags.append(f"AI triage remains {triage_label}, so discharge planning should include escalation review.")
        severity = _raise_level(severity, "high" if triage_label == "High" else "critical")

    if patient.get("worsening_flag"):
        flags.append("Trend analysis suggests the patient is worsening rather than recovering.")
        severity = _raise_level(severity, "high")

    if (patient.get("risk_trajectory") or "").lower() == "worsening":
        flags.append("Recent symptom trajectory is marked as worsening compared with prior encounters.")
        severity = _raise_level(severity, "high")

    repeat_count = int(patient.get("repeat_symptom_count") or 0)
    if repeat_count >= 2:
        repeated = patient.get("repeated_symptoms") or patient.get("symptoms") or []
        flags.append(f"Recurring concerns include {_compact(repeated[:3], 'repeat symptoms')}, which raises relapse risk.")
        severity = _raise_level(severity, "medium")

    latest_vital = vitals[0] if vitals else {}
    if latest_vital and (latest_vital.get("severity") or "").lower() in {"high", "critical"} and triage_label in {"High", "Critical"}:
        flags.append("Both symptom acuity and bedside vitals are elevated, so this case should stay on the active review queue.")
        severity = _raise_level(severity, "critical")

    return flags[:4], severity


def build_clinical_safety_snapshot(
    patient: dict[str, Any],
    *,
    vitals: list[dict[str, Any]] | None = None,
    documents: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    scoped_vitals = list(vitals) if vitals is not None else list_vitals(patient_user_id=patient.get("user_id"))[:5]
    scoped_documents = list(documents) if documents is not None else list_documents(patient_user_id=patient.get("user_id"))[:6]
    medications = _current_medications(scoped_documents)
    medication_risk = build_medication_risk_snapshot(patient, documents=scoped_documents, vitals=scoped_vitals)

    vital_risk_flags, vital_level = _build_vital_risk_flags(patient, scoped_vitals)
    drug_risk_flags, drug_level = _build_drug_risk_flags(patient, medications)
    condition_flags, condition_level = _build_condition_risk_flags(patient, scoped_vitals)
    medication_level = (medication_risk.get("medication_risk_level") or "Low").lower()

    safety_flags = [
        *condition_flags,
        *vital_risk_flags,
        *drug_risk_flags,
        *(medication_risk.get("medication_interaction_flags") or []),
        *(medication_risk.get("medication_contraindications") or []),
    ][:8]
    clinical_alert_level = "low"
    for level in [vital_level, drug_level, condition_level, medication_level]:
        clinical_alert_level = _raise_level(clinical_alert_level, level)

    if clinical_alert_level == "critical":
        recommendation = "Keep this patient on the urgent clinical review queue and confirm escalation/disposition before closure."
    elif clinical_alert_level == "high":
        recommendation = "Clinician should review vitals, medicines, and follow-up plan before completing the encounter."
    elif clinical_alert_level == "medium":
        recommendation = "Manual safety reconciliation is recommended before final sign-off."
    else:
        recommendation = "No major safety conflict was auto-detected, but routine review is still recommended."

    return {
        "clinical_alert_level": clinical_alert_level.title(),
        "safety_flags": safety_flags,
        "drug_risk_flags": drug_risk_flags,
        "vital_risk_flags": vital_risk_flags,
        "condition_risk_flags": condition_flags,
        "medication_risk_level": medication_risk.get("medication_risk_level", "Low"),
        "medication_risk_summary": medication_risk.get("medication_risk_summary", ""),
        "medication_interaction_flags": medication_risk.get("medication_interaction_flags", []),
        "medication_contraindications": medication_risk.get("medication_contraindications", []),
        "medication_monitoring_actions": medication_risk.get("medication_monitoring_actions", []),
        "interacting_medications": medication_risk.get("interacting_medications", []),
        "safety_recommendation": recommendation,
        "last_safety_check_at": utc_now(),
        "medication_count": len(medications),
        "vitals_reviewed": len(scoped_vitals),
        "documents_reviewed": len(scoped_documents),
    }


def enrich_patient_with_clinical_safety(patient: dict[str, Any]) -> dict[str, Any]:
    return {
        **patient,
        **build_clinical_safety_snapshot(patient),
    }


def _latest_appointment_by_patient(appointments: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    scoped: dict[str, dict[str, Any]] = {}
    ordered = sorted(
        appointments,
        key=lambda appointment: (
            appointment.get("updated_at") or "",
            appointment.get("created_at") or "",
        ),
        reverse=True,
    )
    for appointment in ordered:
        patient_user_id = appointment.get("patient_user_id")
        if patient_user_id and patient_user_id not in scoped:
            scoped[patient_user_id] = appointment
    return scoped


def build_clinical_safety_watch(
    patients: list[dict[str, Any]],
    *,
    appointments: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    summary = {"Critical": 0, "High": 0, "Medium": 0, "Low": 0}
    appointment_lookup = _latest_appointment_by_patient(appointments or [])
    sorted_patients = sorted(
        patients,
        key=lambda patient: (
            _severity_value(patient.get("clinical_alert_level", "Low")),
            patient.get("triage_score") or 0,
            patient.get("deterioration_prediction_score") or 0,
        ),
        reverse=True,
    )

    watch = []
    for patient in sorted_patients:
        level = patient.get("clinical_alert_level") or "Low"
        summary[level] = summary.get(level, 0) + 1
        if len(watch) >= 6:
            continue
        appointment = appointment_lookup.get(patient.get("user_id"))
        watch.append(
            {
                "id": patient.get("id"),
                "name": patient.get("name"),
                "email": patient.get("email"),
                "assigned_doctor_name": patient.get("assigned_doctor_name") or "",
                "clinical_alert_level": level,
                "safety_recommendation": patient.get("safety_recommendation") or "",
                "safety_flags": patient.get("safety_flags") or [],
                "drug_risk_flags": patient.get("drug_risk_flags") or [],
                "vital_risk_flags": patient.get("vital_risk_flags") or [],
                "appointment_id": appointment.get("id") if appointment else None,
                "safety_workflow": {
                    "status": appointment.get("safety_workflow_status") if appointment else "open",
                    "note": appointment.get("safety_workflow_note") if appointment else "",
                    "updated_at": appointment.get("safety_workflow_updated_at") if appointment else None,
                    "updated_by": appointment.get("safety_workflow_updated_by") if appointment else "",
                    "history": appointment.get("safety_workflow_history") if appointment else [],
                },
                "updated_at": patient.get("updated_at"),
            }
        )

    return {
        "clinical_safety_summary": {
            "critical": summary.get("Critical", 0),
            "high": summary.get("High", 0),
            "medium": summary.get("Medium", 0),
            "low": summary.get("Low", 0),
        },
        "clinical_safety_watch": watch,
    }
