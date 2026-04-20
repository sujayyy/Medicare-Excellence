from __future__ import annotations

from typing import Any

from models.appointment_model import list_appointments
from models.chat_model import get_chat_by_user_id, serialize_chat_history
from models.document_model import list_documents
from models.patient_model import get_patient_by_user_id
from models.vital_model import list_vitals
from services.early_warning_service import build_early_warning_snapshot
from services.followup_dropout_service import build_followup_dropout_snapshot
from services.readmission_risk_service import build_readmission_risk_snapshot


def _clean(value: Any) -> str:
    return " ".join(str(value or "").split()).strip()


def _risk_level(profile: dict[str, Any]) -> str:
    return profile.get("triage_label") or profile.get("risk_level") or "Low"


def _build_journey_summary(
    profile: dict[str, Any],
    appointments: list[dict[str, Any]],
    vitals: list[dict[str, Any]],
    documents: list[dict[str, Any]],
    early_warning: dict[str, Any],
    readmission_risk: dict[str, Any],
    followup_dropout: dict[str, Any],
) -> str:
    parts: list[str] = []
    symptoms = profile.get("symptoms") or []
    if symptoms:
        parts.append(f"Current tracked concerns include {', '.join(symptoms[:3])}.")
    if (early_warning.get("early_warning_priority") or "Low") in {"High", "Critical"}:
        parts.append(f"Current early-warning priority is {early_warning.get('early_warning_priority')} with action: {early_warning.get('early_warning_response')}.")
    if appointments:
        latest_appointment = appointments[0]
        parts.append(
            f"Latest appointment status is {latest_appointment.get('status', 'requested')} with {latest_appointment.get('assigned_doctor_name') or 'the care team'}."
        )
    if vitals:
        parts.append(vitals[0].get("summary") or "Recent bedside vitals are available.")
    if documents:
        parts.append(f"{len(documents)} medical document(s) are linked to this care record.")
    if (readmission_risk.get("readmission_risk_label") or "Low") in {"High", "Critical"}:
        parts.append(
            f"Relapse watch is {readmission_risk.get('readmission_risk_label')} with a suggested review in {readmission_risk.get('relapse_risk_window')}."
        )
    if (followup_dropout.get("followup_dropout_risk_label") or "Low") in {"High", "Critical"}:
        parts.append(
            f"Follow-up dropout risk is {followup_dropout.get('followup_dropout_risk_label')} and needs outreach in {followup_dropout.get('followup_outreach_window')}."
        )

    if not parts:
        return "This patient profile is ready to start building a longitudinal care record."
    return " ".join(parts[:3])


def _build_care_gaps(
    profile: dict[str, Any],
    appointments: list[dict[str, Any]],
    vitals: list[dict[str, Any]],
    documents: list[dict[str, Any]],
    early_warning: dict[str, Any],
    readmission_risk: dict[str, Any],
    followup_dropout: dict[str, Any],
) -> list[str]:
    gaps: list[str] = []
    if (early_warning.get("early_warning_priority") or "Low") in {"High", "Critical"} and not appointments:
        gaps.append("The early-warning engine is elevated but no active appointment is linked yet.")
    if not appointments and (_risk_level(profile) in {"Medium", "High", "Critical"}):
        gaps.append("No appointment is linked yet despite active symptom tracking.")
    if not vitals and (_risk_level(profile) in {"High", "Critical"}):
        gaps.append("Fresh vitals are missing for a higher-risk presentation.")
    if profile.get("worsening_flag") and not appointments:
        gaps.append("Worsening symptom trend should be followed with a clinician review.")
    if documents and any((document.get("abnormal_findings") or []) for document in documents):
        gaps.append("At least one uploaded document contains abnormal findings that need clinical follow-up.")
    if (readmission_risk.get("readmission_risk_label") or "Low") in {"High", "Critical"}:
        gaps.append("Return-risk prediction is elevated, so the follow-up plan should be closed-loop and time-bound.")
    if (followup_dropout.get("followup_dropout_risk_label") or "Low") in {"High", "Critical"}:
        gaps.append("The patient may miss the next review unless reminder outreach is started early.")
    if not documents:
        gaps.append("No reports, prescriptions, or discharge notes are attached yet.")
    return gaps[:5]


def _build_chat_events(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    events = []
    for message in messages:
        if message.get("role") != "user":
            continue
        content = _clean(message.get("content"))
        if not content:
            continue
        events.append(
            {
                "type": "chat",
                "timestamp": message.get("created_at"),
                "title": "Patient symptom update",
                "detail": content[:220],
                "severity": "medium",
            }
        )
    return events[-8:]


def _build_appointment_events(appointments: list[dict[str, Any]]) -> list[dict[str, Any]]:
    events = []
    for appointment in appointments:
        events.append(
            {
                "type": "appointment",
                "timestamp": appointment.get("updated_at") or appointment.get("created_at"),
                "title": f"Appointment {appointment.get('status', 'requested')}",
                "detail": _clean(
                    f"{appointment.get('reason') or 'Visit reason not shared'} "
                    f"with {appointment.get('assigned_doctor_name') or 'care team'} "
                    f"on {appointment.get('appointment_date') or 'pending date'} {appointment.get('appointment_time') or ''}"
                ),
                "severity": "high" if (appointment.get("status") or "").lower() in {"requested", "in_consultation"} else "low",
            }
        )
    return events[:8]


def _build_vital_events(vitals: list[dict[str, Any]]) -> list[dict[str, Any]]:
    events = []
    for vital in vitals[:6]:
        events.append(
            {
                "type": "vital",
                "timestamp": vital.get("created_at"),
                "title": "Vitals recorded",
                "detail": _clean(
                    f"{vital.get('summary') or 'Vital record saved'} "
                    f"(Pulse {vital.get('pulse')}, SpO2 {vital.get('spo2')}%, BP {vital.get('systolic_bp')}/{vital.get('diastolic_bp')})"
                ),
                "severity": vital.get("severity") or "low",
            }
        )
    return events


def _build_document_events(documents: list[dict[str, Any]]) -> list[dict[str, Any]]:
    events = []
    for document in documents[:6]:
        finding = ""
        if document.get("abnormal_findings"):
            finding = document["abnormal_findings"][0]
        elif document.get("clinical_highlights"):
            finding = document["clinical_highlights"][0]
        else:
            finding = document.get("summary") or "Medical document uploaded."
        events.append(
            {
                "type": "document",
                "timestamp": document.get("created_at"),
                "title": f"{(document.get('document_type') or 'document').replace('_', ' ').title()} added",
                "detail": _clean(f"{document.get('title') or 'Document'}: {finding}"),
                "severity": "high" if document.get("abnormal_findings") else document.get("review_priority", "low").lower(),
            }
        )
    return events


def _build_visit_events(visit_history: list[dict[str, Any]]) -> list[dict[str, Any]]:
    events = []
    for visit in visit_history[:6]:
        events.append(
            {
                "type": "visit",
                "timestamp": visit.get("completed_at"),
                "title": "Consultation completed",
                "detail": _clean(
                    f"{visit.get('visit_reason') or visit.get('diagnosis_summary') or 'Consultation review'} "
                    f"with {visit.get('doctor_name') or 'doctor'}."
                ),
                "severity": "low",
            }
        )
    return events


def build_patient_digital_twin(user_id: str) -> dict[str, Any]:
    profile = get_patient_by_user_id(user_id) or {}
    chat = serialize_chat_history(get_chat_by_user_id(user_id))
    appointments = list_appointments(patient_user_id=user_id)
    vitals = list_vitals(patient_user_id=user_id)
    documents = list_documents(patient_user_id=user_id)
    visit_history = list(profile.get("visit_history") or [])
    early_warning = build_early_warning_snapshot(profile, vitals=vitals)
    readmission_risk = build_readmission_risk_snapshot(profile, vitals=vitals, documents=documents)
    followup_dropout = build_followup_dropout_snapshot(profile)

    timeline = [
        *_build_chat_events(chat.get("messages") or []),
        *_build_appointment_events(appointments),
        *_build_vital_events(vitals),
        *_build_document_events(documents),
        *_build_visit_events(visit_history),
    ]
    timeline.sort(key=lambda item: item.get("timestamp") or "", reverse=True)

    care_phase = "Monitoring"
    if appointments:
        care_phase = (appointments[0].get("status") or "Monitoring").replace("_", " ").title()
    elif _risk_level(profile) in {"High", "Critical"}:
        care_phase = "Active review"

    return {
        "journey_summary": _build_journey_summary(profile, appointments, vitals, documents, early_warning, readmission_risk, followup_dropout),
        "care_phase": care_phase,
        "timeline_events": timeline[:16],
        "care_gaps": _build_care_gaps(profile, appointments, vitals, documents, early_warning, readmission_risk, followup_dropout),
        "counts": {
            "messages": len(chat.get("messages") or []),
            "appointments": len(appointments),
            "vitals": len(vitals),
            "documents": len(documents),
            "visits": len(visit_history),
        },
    }
