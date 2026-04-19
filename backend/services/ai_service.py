import os
from typing import Any, Optional

try:
    import google.generativeai as genai
except Exception:  # pragma: no cover - optional dependency path
    genai = None


FALLBACK_RESPONSES = {
    "headache": {
        "understood": "You mentioned a headache, which can happen with dehydration, stress, migraine, or infection.",
        "care_steps": [
            "Rest in a quiet place and drink fluids.",
            "Avoid bright screens if they make the pain worse.",
        ],
        "urgent_help": [
            "The headache is sudden and severe.",
            "You have weakness, confusion, or vision trouble.",
        ],
    },
    "fever": {
        "understood": "You mentioned fever, which is often linked to infection or inflammation.",
        "care_steps": [
            "Drink plenty of fluids and rest.",
            "Monitor the temperature if you can.",
        ],
        "urgent_help": [
            "The fever is very high or lasts more than 2 days.",
            "You have trouble breathing, confusion, or severe weakness.",
        ],
    },
    "cough": {
        "understood": "You mentioned cough, which is commonly seen with viral illness, allergies, or irritation in the airway.",
        "care_steps": [
            "Use warm fluids and rest.",
            "Avoid smoke or strong irritants.",
        ],
        "urgent_help": [
            "You are short of breath.",
            "You cough up blood or have chest pain.",
        ],
    },
    "chest pain": {
        "understood": "You mentioned chest pain, which needs careful attention because it can sometimes be serious.",
        "care_steps": [
            "Stop activity and sit down.",
            "Get in-person medical help urgently.",
        ],
        "urgent_help": [
            "The pain is severe, spreading, or linked with sweating or breathlessness.",
            "You feel faint, very weak, or unsafe.",
        ],
    },
    "blood pressure": {
        "understood": "You mentioned a blood pressure concern, which may be affected by stress, medication, or chronic hypertension.",
        "care_steps": [
            "Sit calmly for a few minutes and recheck the reading if possible.",
            "Reduce salt and avoid strenuous activity until you feel stable.",
        ],
        "urgent_help": [
            "Your reading is very high and you also have chest pain, headache, or shortness of breath.",
            "You feel dizzy, confused, or unwell.",
        ],
    },
}


def _first_non_empty(values: list[str], fallback: str) -> str:
    for value in values:
        if value:
            return value
    return fallback


def _format_bullets(items: list[str]) -> str:
    return "\n".join(f"- {item}" for item in items if item)


def _build_patient_context_note(patient_context: Optional[dict[str, Any]]) -> str:
    if not patient_context:
        return ""

    demographics = []
    if patient_context.get("age"):
        demographics.append(f"age {patient_context['age']}")
    if patient_context.get("gender"):
        demographics.append(str(patient_context["gender"]).replace("_", " "))

    latest_visit = (patient_context.get("visit_history") or [None])[0]
    latest_visit_note = ""
    if latest_visit:
        specialty = str(latest_visit.get("doctor_specialty") or "").replace("_", " ").strip()
        visit_reason = latest_visit.get("visit_reason") or latest_visit.get("diagnosis_summary") or ""
        latest_visit_note = _first_non_empty(
            [
                f"Recent visit: {visit_reason} with {specialty}." if visit_reason and specialty else "",
                f"Recent visit: {visit_reason}." if visit_reason else "",
            ],
            "",
        )

    demographic_text = f"Profile: {', '.join(demographics)}." if demographics else ""
    return " ".join(part for part in [demographic_text, latest_visit_note] if part).strip()


def _build_fallback_sections(
    user_message: str,
    triage: Optional[dict[str, Any]] = None,
    entities: Optional[dict[str, Any]] = None,
    patient_context: Optional[dict[str, Any]] = None,
) -> str:
    message = user_message.lower()
    guidance = next((value for key, value in FALLBACK_RESPONSES.items() if key in message), None)
    symptoms = (entities or {}).get("symptoms") or []
    duration_text = (entities or {}).get("duration_text") or ""
    triage_label = (triage or {}).get("triage_label") or "Medium"
    recommended_action = (triage or {}).get("recommended_action") or "Monitor symptoms and contact a clinician if things get worse."
    context_note = _build_patient_context_note(patient_context)

    if not guidance:
        symptom_phrase = ", ".join(symptoms[:2]) if symptoms else "your symptoms"
        understood = f"You mentioned {symptom_phrase}."
        care_steps = [
            "Rest, drink fluids, and avoid self-medicating beyond basic over-the-counter care.",
            recommended_action,
        ]
        urgent_help = [
            "Your symptoms are rapidly getting worse.",
            "You develop chest pain, breathing trouble, confusion, or severe weakness.",
        ]
    else:
        understood = guidance["understood"]
        if duration_text:
            understood = f"{understood} You said it has been present {duration_text}."
        care_steps = guidance["care_steps"] + [recommended_action]
        urgent_help = guidance["urgent_help"]

    if context_note:
        understood = f"{understood} {context_note}".strip()

    return "\n\n".join(
        [
            f"**What I understood**\n- {understood}",
            f"**What you can do now**\n{_format_bullets(care_steps[:3])}",
            f"**Urgency**\n- Current AI triage: {triage_label}",
            f"**Get urgent help now if**\n{_format_bullets(urgent_help[:2])}",
        ]
    )


def get_ai_response(
    user_message: str,
    language_preference: Optional[str] = None,
    *,
    triage: Optional[dict[str, Any]] = None,
    entities: Optional[dict[str, Any]] = None,
    patient_context: Optional[dict[str, Any]] = None,
) -> str:
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key or genai is None:
        return _build_fallback_sections(user_message, triage=triage, entities=entities, patient_context=patient_context)

    try:
        genai.configure(api_key=api_key)
        model = genai.GenerativeModel("models/gemini-2.5-flash")
        response = model.generate_content(
            f"""
You are Medicare Excellence, a calm patient-facing healthcare assistant.

Your job is to answer like ChatGPT would for a patient:
- short
- structured
- easy to understand
- not overly theoretical
- not scary unless the case is urgent

Respond in the same language as the user.
If a language preference is provided, use that language when reasonable.

Use EXACTLY these markdown sections:
**What I understood**
- one short bullet

**What you can do now**
- 2 or 3 short bullets

**Urgency**
- one short bullet using Low / Medium / High / Critical

**Get urgent help now if**
- up to 2 short bullets

Rules:
- keep the total answer under 120 words
- avoid long theory, long disease lists, and medical jargon
- do not say "possible causes" unless truly needed
- do not diagnose
- write for a patient, not a doctor

Language preference: {language_preference or 'same as user input'}
Current triage label: {(triage or {}).get('triage_label', 'Medium')}
Current triage reason: {(triage or {}).get('triage_reason', '')}
Symptoms extracted: {', '.join((entities or {}).get('symptoms', [])[:4]) or 'none'}
Duration extracted: {(entities or {}).get('duration_text', '') or 'not stated'}
Patient profile context: {_build_patient_context_note(patient_context) or 'No prior visit context available'}
User: {user_message}
"""
        )

        return (response.text or "").strip() or _build_fallback_sections(
            user_message,
            triage=triage,
            entities=entities,
            patient_context=patient_context,
        )
    except Exception:
        return _build_fallback_sections(user_message, triage=triage, entities=entities, patient_context=patient_context)
