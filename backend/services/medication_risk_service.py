from __future__ import annotations

from typing import Any


INTERACTION_RULES = [
    {
        "medications": ("ibuprofen", "diclofenac"),
        "message": "Multiple NSAIDs appear together, which increases gastrointestinal and renal risk.",
        "level": "high",
    },
    {
        "medications": ("ibuprofen", "naproxen"),
        "message": "More than one NSAID is present, which raises bleeding and kidney-risk concerns.",
        "level": "high",
    },
    {
        "medications": ("diclofenac", "naproxen"),
        "message": "Concurrent NSAID therapy may increase bleeding and kidney-risk burden.",
        "level": "high",
    },
    {
        "medications": ("amoxicillin", "azithromycin"),
        "message": "Two antibiotic agents appear together, so indication and antimicrobial plan should be reconciled.",
        "level": "medium",
    },
    {
        "medications": ("prednisolone", "ibuprofen"),
        "message": "Steroid and NSAID therapy together may increase gastritis and GI-bleeding risk.",
        "level": "high",
    },
]

RENAL_RISK_MEDS = {"ibuprofen", "diclofenac", "naproxen", "aceclofenac", "ketorolac", "metformin"}
GLUCOSE_RISK_MEDS = {"prednisolone", "methylpred", "dexamethasone", "hydrocortisone", "dexa"}
BP_RISK_MEDS = {"ibuprofen", "diclofenac", "naproxen", "aceclofenac"}
CARDIAC_DELAY_MEDS = {"paracetamol", "acetaminophen"}
SEDATION_MEDS = {"cetirizine"}


def _clean(value: Any) -> str:
    return " ".join(str(value or "").split()).strip()


def _severity_value(level: str) -> int:
    order = {"low": 1, "medium": 2, "high": 3, "critical": 4}
    return order.get((level or "low").lower(), 1)


def _raise_level(current: str, incoming: str) -> str:
    return incoming if _severity_value(incoming) > _severity_value(current) else current


def _medication_names(documents: list[dict[str, Any]]) -> list[str]:
    names: list[str] = []
    for document in documents:
        if document.get("document_type") != "prescription":
            continue
        for medication in document.get("medication_schedule") or []:
            name = _clean(medication.get("drug_name")).lower()
            if name:
                names.append(name)
    return names


def _latest_lab_documents(documents: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [document for document in documents if document.get("document_type") == "lab_report"][:3]


def build_medication_risk_snapshot(
    patient: dict[str, Any],
    *,
    documents: list[dict[str, Any]] | None = None,
    vitals: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    scoped_documents = documents or []
    scoped_vitals = vitals or []
    medication_names = _medication_names(scoped_documents)
    medication_set = set(medication_names)
    latest_vital = scoped_vitals[0] if scoped_vitals else {}
    lab_documents = _latest_lab_documents(scoped_documents)

    interaction_flags: list[str] = []
    contraindications: list[str] = []
    monitoring_actions: list[str] = []
    level = "low"

    for rule in INTERACTION_RULES:
        if all(any(med in name for name in medication_set) for med in rule["medications"]):
            interaction_flags.append(rule["message"])
            level = _raise_level(level, rule["level"])

    for lab_document in lab_documents:
        abnormal_findings = " ".join(lab_document.get("abnormal_findings") or []).lower()
        if any("creatinine" in finding.lower() for finding in lab_document.get("abnormal_findings") or []):
            risky = [name for name in medication_names if any(trigger in name for trigger in RENAL_RISK_MEDS)]
            if risky:
                contraindications.append(
                    f"Renal-risk medicine review needed because creatinine is abnormal while {', '.join(sorted(set(risky))[:2])} is active."
                )
                level = _raise_level(level, "high")
        if any("glucose" in finding.lower() or "hba1c" in finding.lower() for finding in lab_document.get("abnormal_findings") or []):
            risky = [name for name in medication_names if any(trigger in name for trigger in GLUCOSE_RISK_MEDS)]
            if risky:
                contraindications.append(
                    f"Steroid-linked glucose monitoring is needed because {', '.join(sorted(set(risky))[:2])} appears with abnormal sugar markers."
                )
                level = _raise_level(level, "medium")
        if any("potassium" in finding.lower() or "sodium" in finding.lower() for finding in lab_document.get("abnormal_findings") or []):
            monitoring_actions.append("Electrolyte abnormalities should be reconciled against the active medicine list before discharge.")
            level = _raise_level(level, "medium")
        if "troponin" in abnormal_findings and any(any(trigger in name for trigger in CARDIAC_DELAY_MEDS) for name in medication_names):
            contraindications.append("Symptom-relief medication should not delay escalation while cardiac-injury markers are abnormal.")
            level = _raise_level(level, "high")

    systolic = latest_vital.get("systolic_bp")
    diastolic = latest_vital.get("diastolic_bp")
    glucose = latest_vital.get("glucose")
    spo2 = latest_vital.get("spo2")

    try:
        if float(systolic) >= 140 or float(diastolic) >= 90:
            risky = [name for name in medication_names if any(trigger in name for trigger in BP_RISK_MEDS)]
            if risky:
                contraindications.append(
                    f"NSAID review is advised because blood pressure remains elevated while {', '.join(sorted(set(risky))[:2])} is active."
                )
                level = _raise_level(level, "high")
    except (TypeError, ValueError):
        pass

    try:
        if float(glucose) >= 180:
            risky = [name for name in medication_names if any(trigger in name for trigger in GLUCOSE_RISK_MEDS)]
            if risky:
                contraindications.append(
                    f"Hyperglycemia monitoring is needed because {', '.join(sorted(set(risky))[:2])} may worsen glucose control."
                )
                level = _raise_level(level, "medium")
    except (TypeError, ValueError):
        pass

    try:
        if float(spo2) < 94 and any(any(trigger in name for trigger in SEDATION_MEDS) for name in medication_names):
            monitoring_actions.append("Avoid overly sedating medicines until respiratory status is reassessed.")
            level = _raise_level(level, "medium")
    except (TypeError, ValueError):
        pass

    triage_text = " ".join(
        [
            _clean(patient.get("last_summary")).lower(),
            " ".join(str(item).lower() for item in patient.get("symptoms") or []),
            " ".join(str(item).lower() for item in patient.get("red_flags") or []),
        ]
    )
    if ("chest pain" in triage_text or "left arm" in triage_text) and any(any(trigger in name for trigger in CARDIAC_DELAY_MEDS) for name in medication_names):
        contraindications.append("Analgesic-only treatment should not delay urgent cardiac evaluation when chest-pain red flags remain active.")
        level = _raise_level(level, "high")

    if medication_names and not monitoring_actions:
        monitoring_actions.append("Reconcile current medicines against allergies, renal function, glucose control, and vital instability before sign-off.")

    interaction_flags = list(dict.fromkeys(interaction_flags))[:4]
    contraindications = list(dict.fromkeys(contraindications))[:4]
    monitoring_actions = list(dict.fromkeys(monitoring_actions))[:4]

    if level == "critical":
        summary = "Medication plan has critical interaction or contraindication concerns and needs immediate clinician review."
    elif level == "high":
        summary = "Medication plan has high-risk interaction or contraindication concerns that should be reconciled before closure."
    elif level == "medium":
        summary = "Medication plan has moderate interaction or monitoring risks that need a manual review."
    elif medication_names:
        summary = "No major medication interaction was auto-detected, but routine reconciliation is still recommended."
    else:
        summary = "No active medication list is available yet for interaction analysis."

    return {
        "medication_risk_level": level.title(),
        "medication_risk_summary": summary,
        "medication_interaction_flags": interaction_flags,
        "medication_contraindications": contraindications,
        "medication_monitoring_actions": monitoring_actions,
        "interacting_medications": sorted(set(medication_names))[:8],
    }
