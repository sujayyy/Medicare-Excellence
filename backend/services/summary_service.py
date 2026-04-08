from typing import Any


def _format_list(values: list[str], fallback: str) -> str:
    cleaned = [value for value in values if value]
    if not cleaned:
        return fallback
    if len(cleaned) == 1:
        return cleaned[0]
    if len(cleaned) == 2:
        return f"{cleaned[0]} and {cleaned[1]}"
    return f"{', '.join(cleaned[:-1])}, and {cleaned[-1]}"


def _section(title: str, content: str) -> str:
    return f"{title}: {content}"


def build_patient_summary(
    *,
    patient_name: str,
    user_message: str,
    triage: dict[str, Any],
    entities: dict[str, Any],
    current_status: str,
) -> dict[str, str]:
    symptoms = entities.get("symptoms", [])
    red_flags = entities.get("red_flags", [])
    body_parts = entities.get("body_parts", [])
    medications = entities.get("medications_mentioned", [])
    duration_text = entities.get("duration_text") or "duration not clearly stated"

    symptom_text = _format_list(symptoms, "general symptoms")
    red_flag_text = _format_list(red_flags, "no red-flag symptoms extracted")
    body_part_text = _format_list(body_parts, "no clear body location extracted")
    medication_text = _format_list(medications, "no medications mentioned")
    triage_label = triage.get("triage_label", "Low")
    triage_score = triage.get("triage_score", 0)
    triage_reason = triage.get("triage_reason", "No triage reason available.")
    recommended_action = triage.get("recommended_action", "Continue monitoring.")

    headline = f"{patient_name or 'Patient'} is currently {triage_label.lower()} risk."
    soap_summary = (
        f"Patient reported {symptom_text}. Duration: {duration_text}. "
        f"Affected areas: {body_part_text}. Medications mentioned: {medication_text}. "
        f"Latest message: {user_message}"
    )
    clinical_summary = f"Status: {current_status}. Triage: {triage_label} ({triage_score}/100). Reason: {triage_reason}"
    escalation_note = (
        f"Red flags: {red_flag_text}. Recommended follow-up: {recommended_action}"
    )
    clinical_note = "\n".join(
        [
            _section("Subjective", f"{patient_name or 'Patient'} reports {symptom_text} with {duration_text}. Latest message: {user_message}"),
            _section("Objective", f"AI triage {triage_label} ({triage_score}/100). Affected areas: {body_part_text}. Medications: {medication_text}. Red flags: {red_flag_text}."),
            _section("Assessment", triage_reason),
            _section("Plan", f"{recommended_action} Current workflow status: {current_status}."),
        ]
    )

    return {
        "summary_headline": headline,
        "soap_summary": soap_summary,
        "clinical_summary": clinical_summary,
        "escalation_note": escalation_note,
        "clinical_note": clinical_note,
    }
