from __future__ import annotations

from typing import Any

from models.chat_model import get_chat_by_user_id, serialize_chat_history
from models.document_model import list_documents
from models.patient_model import get_patient_by_user_id
from models.vital_model import list_vitals
from services.clinical_safety_service import build_clinical_safety_snapshot
from services.doctor_routing_service import get_specialty_label, get_specialty_match
from services.early_warning_service import build_early_warning_snapshot
from services.followup_dropout_service import build_followup_dropout_snapshot
from services.readmission_risk_service import build_readmission_risk_snapshot


SYMPTOM_BUCKETS: list[dict[str, Any]] = [
    {
        "label": "Possible acute coronary or cardiac ischemia pattern",
        "keywords": {"chest pain", "left arm", "sweating", "palpitations", "crushing chest pain"},
    },
    {
        "label": "Respiratory or lower-airway compromise pattern",
        "keywords": {"shortness of breath", "breathing difficulty", "wheeze", "cough", "low spo2"},
    },
    {
        "label": "Headache, migraine, or neurologic review needed",
        "keywords": {"headache", "blurred vision", "dizziness", "vertigo", "weakness", "numbness"},
    },
    {
        "label": "Fever, viral illness, or infectious syndrome",
        "keywords": {"fever", "chills", "sore throat", "body ache", "infection"},
    },
    {
        "label": "Gastrointestinal or dehydration-related presentation",
        "keywords": {"abdominal pain", "vomiting", "diarrhea", "nausea", "stomach pain"},
    },
    {
        "label": "Dermatology or allergic reaction review",
        "keywords": {"rash", "itching", "swelling", "hives", "allergy"},
    },
    {
        "label": "Metabolic or chronic disease control review",
        "keywords": {"glucose", "sugar", "blood pressure", "hypertension", "diabetes"},
    },
    {
        "label": "Mental health or anxiety-related review",
        "keywords": {"anxious", "panic", "stress", "cannot sleep", "insomnia"},
    },
]

KEYWORD_LOOKUP = {
    "chest pain",
    "left arm",
    "sweating",
    "shortness of breath",
    "breathing difficulty",
    "cough",
    "wheeze",
    "headache",
    "blurred vision",
    "dizziness",
    "vertigo",
    "weakness",
    "numbness",
    "fever",
    "chills",
    "sore throat",
    "body ache",
    "infection",
    "abdominal pain",
    "vomiting",
    "diarrhea",
    "nausea",
    "stomach pain",
    "rash",
    "itching",
    "swelling",
    "hives",
    "allergy",
    "glucose",
    "sugar",
    "blood pressure",
    "hypertension",
    "diabetes",
    "anxious",
    "panic",
    "stress",
    "cannot sleep",
    "insomnia",
}

ANTIBIOTIC_HINTS = {"amoxicillin", "azithromycin", "cef", "clav", "doxy", "cipro", "antibiotic"}
NSAID_HINTS = {"ibuprofen", "diclofenac", "naproxen", "aceclofenac", "ketorolac"}


def _clean_sentence(value: str) -> str:
    return " ".join((value or "").split()).strip()


def _compact_list(values: list[str], fallback: str) -> str:
    cleaned = [_clean_sentence(value) for value in values if _clean_sentence(value)]
    if not cleaned:
        return fallback
    if len(cleaned) == 1:
        return cleaned[0]
    if len(cleaned) == 2:
        return f"{cleaned[0]} and {cleaned[1]}"
    return f"{', '.join(cleaned[:-1])}, and {cleaned[-1]}"


def _latest_user_message(chat: dict[str, Any]) -> str:
    for message in reversed(chat.get("messages") or []):
        if message.get("role") == "user" and message.get("content"):
            return _clean_sentence(str(message["content"]))
    return ""


def _flatten_text(parts: list[str]) -> str:
    return " ".join(_clean_sentence(part) for part in parts if _clean_sentence(part)).lower()


def _extract_keywords(text: str) -> set[str]:
    lowered = _clean_sentence(text).lower()
    return {keyword for keyword in KEYWORD_LOOKUP if keyword in lowered}


def _format_vital_reading(vital: dict[str, Any]) -> str:
    if not vital:
        return "No fresh bedside vitals are attached to this appointment yet."

    return (
        f"Pulse {vital.get('pulse', 'N/A')}, SpO2 {vital.get('spo2', 'N/A')}%, "
        f"BP {vital.get('systolic_bp', 'N/A')}/{vital.get('diastolic_bp', 'N/A')}, "
        f"Temp {vital.get('temperature', 'N/A')}, Glucose {vital.get('glucose', 'N/A')}. "
        f"{_clean_sentence(vital.get('summary') or '')}".strip()
    )


def _current_medications(documents: list[dict[str, Any]]) -> list[dict[str, Any]]:
    medications: list[dict[str, Any]] = []
    for document in documents:
        if document.get("document_type") != "prescription":
            continue
        for medication in document.get("medication_schedule") or []:
            if medication.get("drug_name"):
                medications.append(medication)
    return medications


def _diagnosis_buckets(*, appointment: dict[str, Any], patient: dict[str, Any], chat: dict[str, Any], vitals: list[dict[str, Any]]) -> list[str]:
    merged_text = _flatten_text(
        [
            appointment.get("reason", ""),
            appointment.get("patient_notes", ""),
            patient.get("last_summary", ""),
            _latest_user_message(chat),
            " ".join(patient.get("symptoms") or []),
            " ".join(patient.get("red_flags") or []),
            " ".join((vitals[0] or {}).get("anomaly_flags") or []) if vitals else "",
        ]
    )
    matched = [
        bucket["label"]
        for bucket in SYMPTOM_BUCKETS
        if any(keyword in merged_text for keyword in bucket["keywords"])
    ]

    if not matched and patient.get("assigned_doctor_specialty"):
        matched.append(f"{get_specialty_label(patient.get('assigned_doctor_specialty'))} review based on appointment routing")

    if patient.get("triage_label") in {"High", "Critical"}:
        matched.insert(0, f"{patient.get('triage_label')} acuity presentation requiring clinician prioritization")

    if not matched:
        matched.append("General outpatient assessment and focused clinical review")

    return matched[:4]


def _follow_up_plan(*, appointment: dict[str, Any], patient: dict[str, Any], vitals: list[dict[str, Any]], documents: list[dict[str, Any]]) -> list[str]:
    plan: list[str] = []
    triage_label = patient.get("triage_label") or "Low"
    vital_severity = (vitals[0] or {}).get("severity") if vitals else ""

    if triage_label in {"High", "Critical"} or vital_severity in {"high", "critical"}:
        plan.append("Prioritize same-day senior clinician review and do not close the visit without an escalation decision.")
    else:
        plan.append("Complete focused history, examination, and reconciliation of the presenting complaint during this visit.")

    if vitals:
        plan.append("Review and trend bedside vitals against symptoms before finalizing the impression.")
    else:
        plan.append("Capture a fresh set of bedside vitals before completing the consultation note.")

    if documents:
        plan.append("Review uploaded documents and prescriptions with the patient before discharge or follow-up planning.")

    if patient.get("worsening_flag"):
        plan.append("Arrange closer follow-up because the longitudinal trend suggests worsening rather than stable recovery.")
    elif patient.get("followup_priority"):
        plan.append(f"Suggested follow-up priority: {patient.get('followup_priority')}.")

    if appointment.get("status") in {"requested", "confirmed"}:
        plan.append("Confirm the working specialty pathway and next booking milestone before ending the encounter.")

    return plan[:4]


def _medication_safety_reminders(*, medications: list[dict[str, Any]], appointment: dict[str, Any], patient: dict[str, Any]) -> list[str]:
    reminders: list[str] = []
    normalized_names = [_clean_sentence(entry.get("drug_name", "")).lower() for entry in medications if entry.get("drug_name")]
    unique_names = {name for name in normalized_names if name}
    current_text = _flatten_text(
        [
            appointment.get("reason", ""),
            patient.get("last_summary", ""),
            " ".join(patient.get("red_flags") or []),
            " ".join(patient.get("medications_mentioned") or []),
        ]
    )

    if medications:
        reminders.append("Confirm drug allergies, pregnancy status, and renal/hepatic cautions before finalizing the medication plan.")

    if len(unique_names) != len(normalized_names):
        reminders.append("The prescription list may contain duplicate medicines; reconcile before discharge.")

    if any(any(hint in name for hint in ANTIBIOTIC_HINTS) for name in unique_names):
        reminders.append("Verify antibiotic indication, duration, and completion advice with the patient.")

    if any(any(hint in name for hint in NSAID_HINTS) for name in unique_names):
        reminders.append("NSAID use should be reviewed against gastritis, kidney risk, and blood-pressure history.")

    if any(not _clean_sentence(entry.get("dosage", "")) or not _clean_sentence(entry.get("timing", "")) for entry in medications):
        reminders.append("One or more medicines are missing a clear dose or timing; confirm the exact schedule before sign-off.")

    if "chest pain" in current_text and ("paracetamol" in current_text or "acetaminophen" in current_text):
        reminders.append("Symptom relief medication should not delay urgent cardiac review when chest-pain features are present.")

    if not reminders:
        reminders.append("No high-confidence medication risks were auto-detected, but a manual reconciliation check is still recommended.")

    return reminders[:4]


def _changes_since_last_visit(*, appointment: dict[str, Any], patient: dict[str, Any], chat: dict[str, Any], vitals: list[dict[str, Any]]) -> list[str]:
    previous_visit = (patient.get("visit_history") or [None])[0]
    if not previous_visit:
        return ["No completed prior visit is on file, so this consultation will establish the baseline clinical note."]

    previous_text = _flatten_text(
        [
            previous_visit.get("visit_reason", ""),
            previous_visit.get("diagnosis_summary", ""),
            previous_visit.get("consultation_notes", ""),
            previous_visit.get("vitals_summary", ""),
            previous_visit.get("follow_up_plan", ""),
        ]
    )
    current_text = _flatten_text(
        [
            appointment.get("reason", ""),
            appointment.get("patient_notes", ""),
            patient.get("last_summary", ""),
            _latest_user_message(chat),
            " ".join(patient.get("symptoms") or []),
            (vitals[0] or {}).get("summary", "") if vitals else "",
        ]
    )
    previous_keywords = _extract_keywords(previous_text)
    current_keywords = _extract_keywords(current_text)

    recurring = sorted(current_keywords & previous_keywords)
    new_items = sorted(current_keywords - previous_keywords)
    resolved = sorted(previous_keywords - current_keywords)

    summary: list[str] = []
    if recurring:
        summary.append(f"Recurring concerns since last visit: {_compact_list(recurring[:3], 'none')}.")
    if new_items:
        summary.append(f"New issues in this encounter: {_compact_list(new_items[:3], 'none')}.")
    if resolved:
        summary.append(f"Symptoms not clearly repeated today: {_compact_list(resolved[:2], 'none')}.")

    if vitals and (vitals[0].get("severity") in {"high", "critical"}):
        summary.append("Objective severity is higher in this encounter because current vitals contain abnormal values.")

    if not summary:
        summary.append("This encounter looks broadly similar to the last completed visit, so continuity of treatment should be reviewed closely.")

    return summary[:4]


def _build_soap_note(
    *,
    appointment: dict[str, Any],
    patient: dict[str, Any],
    chat: dict[str, Any],
    vitals: list[dict[str, Any]],
    documents: list[dict[str, Any]],
    diagnosis_buckets: list[str],
    follow_up_plan: list[str],
    medication_safety_reminders: list[str],
) -> dict[str, str]:
    symptoms = patient.get("symptoms") or []
    duration_text = patient.get("duration_text") or "duration not clearly stated"
    last_message = _latest_user_message(chat)
    vitals_note = _format_vital_reading(vitals[0] if vitals else {})
    prescription_names = [entry.get("drug_name") for entry in _current_medications(documents) if entry.get("drug_name")]
    document_titles = [document.get("title") for document in documents[:3] if document.get("title")]

    subjective = (
        f"Reason for visit: {appointment.get('reason') or 'not documented'}. "
        f"Patient-reported symptoms: {_compact_list(symptoms, 'no structured symptoms extracted')}. "
        f"Duration: {duration_text}. "
        f"Latest patient message: {last_message or appointment.get('patient_notes') or 'not available'}."
    )
    objective = (
        f"Triage: {patient.get('triage_label', 'Low')} ({patient.get('triage_score', 0)}/100). "
        f"Vitals: {vitals_note} "
        f"Documents reviewed: {_compact_list(document_titles, 'no linked consultation documents yet')}. "
        f"Current medications detected: {_compact_list(prescription_names, 'none auto-detected')}."
    )
    assessment = (
        f"Likely working buckets: {_compact_list(diagnosis_buckets, 'general review required')}. "
        f"Risk rationale: {patient.get('triage_reason') or patient.get('recommended_action') or 'No risk rationale available'}."
    )
    plan = (
        f"Follow-up actions: {_compact_list(follow_up_plan, 'complete routine follow-up')}. "
        f"Medication safety: {_compact_list(medication_safety_reminders, 'standard reconciliation only')}."
    )
    formatted = "\n".join(
        [
            f"Subjective: {subjective}",
            f"Objective: {objective}",
            f"Assessment: {assessment}",
            f"Plan: {plan}",
        ]
    )

    return {
        "subjective": subjective,
        "objective": objective,
        "assessment": assessment,
        "plan": plan,
        "formatted": formatted,
    }


def build_doctor_copilot(appointment: dict[str, Any]) -> dict[str, Any]:
    patient_user_id = appointment.get("patient_user_id")
    patient = get_patient_by_user_id(patient_user_id) if patient_user_id else {}
    chat = serialize_chat_history(get_chat_by_user_id(patient_user_id)) if patient_user_id else {"messages": []}
    vitals = list_vitals(appointment_id=appointment.get("id")) or list_vitals(patient_user_id=patient_user_id)[:3]
    documents = list_documents(appointment_id=appointment.get("id")) or list_documents(patient_user_id=patient_user_id)[:4]

    diagnosis_buckets = _diagnosis_buckets(appointment=appointment, patient=patient or {}, chat=chat or {}, vitals=vitals)
    readmission_risk = build_readmission_risk_snapshot(patient or {}, vitals=vitals, documents=documents)
    followup_dropout = build_followup_dropout_snapshot(patient or {})
    follow_up_plan = _follow_up_plan(appointment=appointment, patient=patient or {}, vitals=vitals, documents=documents)
    if (readmission_risk.get("readmission_risk_label") or "Low") in {"High", "Critical"}:
        follow_up_plan = [
            f"Arrange proactive return-prevention outreach within {readmission_risk.get('relapse_risk_window')}.",
            *follow_up_plan,
        ][:5]
    if (followup_dropout.get("followup_dropout_risk_label") or "Low") in {"High", "Critical"}:
        follow_up_plan = [
            f"Use active reminder or coordinator outreach within {followup_dropout.get('followup_outreach_window')}.",
            *follow_up_plan,
        ][:6]
    medication_safety_reminders = _medication_safety_reminders(
        medications=_current_medications(documents),
        appointment=appointment,
        patient=patient or {},
    )
    changes_since_last_visit = _changes_since_last_visit(
        appointment=appointment,
        patient=patient or {},
        chat=chat or {},
        vitals=vitals,
    )
    soap_note = _build_soap_note(
        appointment=appointment,
        patient=patient or {},
        chat=chat or {},
        vitals=vitals,
        documents=documents,
        diagnosis_buckets=diagnosis_buckets,
        follow_up_plan=follow_up_plan,
        medication_safety_reminders=medication_safety_reminders,
    )

    latest_message = _latest_user_message(chat or {})
    clinical_safety = build_clinical_safety_snapshot(patient or {}, vitals=vitals, documents=documents)
    medication_risk_actions = list(clinical_safety.get("medication_monitoring_actions") or [])
    early_warning = build_early_warning_snapshot(patient or {}, vitals=vitals)
    specialty_match = get_specialty_match(
        user_message=" ".join(
            [
                _clean(appointment.get("reason")),
                _clean(appointment.get("patient_notes")),
                _clean(latest_message),
            ]
        ),
        entities={
            "symptoms": patient.get("symptoms") or [],
            "red_flags": patient.get("red_flags") or [],
            "body_parts": patient.get("body_parts") or [],
            "medications_mentioned": patient.get("medications_mentioned") or [],
            "duration_text": patient.get("duration_text") or "",
        },
    )
    evidence_panel = {
        "triage_signal": patient.get("triage_reason") or patient.get("recommended_action") or "No triage explanation available.",
        "specialty_signal": specialty_match.get("reason") or "No specialty explanation available.",
        "specialty_confidence": specialty_match.get("confidence", 0),
        "longitudinal_signal": changes_since_last_visit[0] if changes_since_last_visit else "No prior-visit comparison available.",
    }
    return {
        "care_focus": diagnosis_buckets[0],
        "latest_patient_context": latest_message or appointment.get("reason") or "No recent patient narrative found.",
        "changes_since_last_visit": changes_since_last_visit,
        "suggested_diagnosis_buckets": diagnosis_buckets,
        "suggested_follow_up_plan": follow_up_plan,
        "medication_safety_reminders": (medication_safety_reminders + medication_risk_actions)[:6],
        "clinical_safety": clinical_safety,
        "early_warning": early_warning,
        "readmission_risk": readmission_risk,
        "followup_dropout_risk": followup_dropout,
        "evidence_panel": evidence_panel,
        "soap_note": soap_note,
        "copilot_status": "ready",
        "source_summary": {
            "chat_messages_used": len(chat.get("messages") or []),
            "vitals_used": len(vitals),
            "documents_used": len(documents),
            "prior_visits_used": len((patient or {}).get("visit_history") or []),
        },
    }


def enrich_appointments_with_copilot(appointments: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [{**appointment, "doctor_copilot": build_doctor_copilot(appointment)} for appointment in appointments]
