from __future__ import annotations

import json
import os
import re
from functools import lru_cache
from pathlib import Path
from typing import Any, Optional

import requests

from services.symptom_extraction_service import extract_symptom_entities
from services.triage_service import assess_triage

try:
    import google.generativeai as genai
except Exception:  # pragma: no cover - optional dependency path
    genai = None


# The assistant must always render these sections so the UI receives a predictable reply shape.
REQUIRED_SECTIONS = [
    "Symptoms Summary",
    "Follow-up Questions",
    "Possible Conditions",
    "Risk Level",
    "Recommended Action",
    "General Advice",
    "Emergency Warning",
]

DISCLAIMER_LINE = "Disclaimer: This is not a medical diagnosis."
HF_DEFAULT_TEXT_MODEL = "CohereLabs/aya-expanse-32b:cohere"
KB_PATH = Path(__file__).resolve().parent.parent / "data" / "medical_knowledge_base.json"

SEVERITY_PATTERNS = {
    "severe": ["severe", "terrible", "very bad", "worst", "intense", "extreme"],
    "moderate": ["persistent", "keeps happening", "since yesterday", "since morning", "repeated"],
    "mild": ["mild", "slight", "little", "small", "minor"],
}

DURATION_HINTS = [
    r"for\s+\d+\s+(?:hour|hours|day|days|week|weeks|month|months)",
    r"since\s+(?:yesterday|last night|this morning|today)",
    r"\d+\s+(?:hour|hours|day|days|week|weeks|month|months)\s+ago",
]

GREETING_MESSAGES = {"hi", "hey", "hello", "hii", "hiii", "good morning", "good evening", "good afternoon"}


def _normalize_text(user_message: str) -> str:
    return " ".join((user_message or "").strip().lower().split())


def _extract_severity_label(normalized_text: str) -> str:
    for label, patterns in SEVERITY_PATTERNS.items():
        if any(pattern in normalized_text for pattern in patterns):
            return label
    return "unspecified"


def _extract_duration_hint(normalized_text: str) -> str:
    for pattern in DURATION_HINTS:
        match = re.search(pattern, normalized_text, re.IGNORECASE)
        if match:
            return match.group(0).strip()
    return ""


def _build_patient_context_note(patient_context: Optional[dict[str, Any]]) -> str:
    if not patient_context:
        return ""

    details: list[str] = []
    if patient_context.get("age"):
        details.append(f"Age: {patient_context['age']}")
    if patient_context.get("gender"):
        details.append(f"Gender: {patient_context['gender']}")
    if patient_context.get("assigned_doctor_specialty"):
        specialty = str(patient_context["assigned_doctor_specialty"]).replace("_", " ").title()
        details.append(f"Assigned specialty: {specialty}")

    visits = list(patient_context.get("visit_history") or [])[:2]
    for visit in visits:
        reason = visit.get("visit_reason") or visit.get("diagnosis_summary") or ""
        specialty = str(visit.get("doctor_specialty") or "").replace("_", " ").strip()
        if reason and specialty:
            details.append(f"Recent visit: {reason} ({specialty})")
        elif reason:
            details.append(f"Recent visit: {reason}")

    if patient_context.get("semantic_memory_summary"):
        details.append(f"Memory summary: {patient_context['semantic_memory_summary']}")

    return " | ".join(details)


@lru_cache(maxsize=1)
def _load_medical_knowledge_base() -> list[dict[str, Any]]:
    if not KB_PATH.exists():
        return []
    try:
        payload = json.loads(KB_PATH.read_text())
        if isinstance(payload, list):
            return [entry for entry in payload if isinstance(entry, dict)]
    except Exception:
        return []
    return []


def extract_symptoms(user_message: str) -> dict[str, Any]:
    """Layer 1: normalize the message and extract symptom, duration, and severity hints."""
    normalized_text = _normalize_text(user_message)
    entities = extract_symptom_entities(normalized_text)

    return {
        "normalized_text": normalized_text,
        "raw_text": user_message,
        "symptoms": entities.get("symptoms") or [],
        "duration": entities.get("duration_text") or _extract_duration_hint(normalized_text),
        "severity": _extract_severity_label(normalized_text),
        "body_parts": entities.get("body_parts") or [],
        "red_flags": entities.get("red_flags") or [],
        "medications_mentioned": entities.get("medications_mentioned") or [],
        "entities": entities,
    }


def detect_risk(user_message: str, extracted: Optional[dict[str, Any]] = None) -> dict[str, Any]:
    """Layer 2: hybrid triage using the current rule engine plus a simpler public risk flag."""
    extracted = extracted or extract_symptoms(user_message)
    triage = assess_triage(
        extracted.get("normalized_text") or user_message,
        entities=extracted.get("entities") or extracted,
    )

    triage_label = triage.get("triage_label") or "Medium"
    risk_flag = "LOW"
    if triage_label in {"High", "Critical"}:
        risk_flag = "HIGH"
    elif triage_label == "Medium":
        risk_flag = "MODERATE"

    return {
        **triage,
        "risk_flag": risk_flag,
        "priority_emergency": triage_label in {"High", "Critical"},
    }


def _score_knowledge_entry(entry: dict[str, Any], extracted: dict[str, Any]) -> int:
    score = 0
    normalized_text = extracted.get("normalized_text", "")
    symptoms = set(extracted.get("symptoms") or [])
    body_parts = set(extracted.get("body_parts") or [])

    for symptom in entry.get("symptoms") or []:
        if symptom in symptoms:
            score += 4

    for keyword in entry.get("keywords") or []:
        if keyword in normalized_text:
            score += 2

    for body_part in entry.get("body_parts") or []:
        if body_part in body_parts:
            score += 1

    return score


def retrieve_medical_context(extracted: dict[str, Any]) -> dict[str, Any]:
    """Layer 3 support: fetch lightweight local medical context for prompt grounding."""
    matches: list[tuple[int, dict[str, Any]]] = []
    for entry in _load_medical_knowledge_base():
        score = _score_knowledge_entry(entry, extracted)
        if score > 0:
            matches.append((score, entry))

    matches.sort(key=lambda item: item[0], reverse=True)
    selected_entries = [entry for _, entry in matches[:2]]

    possible_conditions: list[str] = []
    general_advice: list[str] = []
    emergency_signs: list[str] = []
    follow_up_questions: list[str] = []
    snippets: list[str] = []

    for entry in selected_entries:
        for value in entry.get("possible_conditions") or []:
            if value not in possible_conditions:
                possible_conditions.append(value)
        for value in entry.get("general_advice") or []:
            if value not in general_advice:
                general_advice.append(value)
        for value in entry.get("emergency_warning") or []:
            if value not in emergency_signs:
                emergency_signs.append(value)
        for value in entry.get("follow_up_questions") or []:
            if value not in follow_up_questions:
                follow_up_questions.append(value)
        summary = entry.get("clinical_summary") or ""
        if summary:
            snippets.append(summary)

    return {
        "entries": selected_entries,
        "possible_conditions": possible_conditions[:4],
        "general_advice": general_advice[:4],
        "emergency_warning": emergency_signs[:3],
        "follow_up_questions": follow_up_questions[:3],
        "context_snippets": snippets[:2],
    }


def _format_section(title: str, lines: list[str]) -> str:
    cleaned = [line.strip() for line in lines if line and line.strip()]
    if not cleaned:
        cleaned = ["Not enough information yet."]
    return f"**{title}**\n" + "\n".join(f"- {line}" for line in cleaned)


def _safe_possible_conditions(extracted: dict[str, Any], context: dict[str, Any]) -> list[str]:
    symptoms = extracted.get("symptoms") or []
    normalized_text = extracted.get("normalized_text", "")

    if "fever" in symptoms and "headache" in symptoms:
        return [
            "Viral fever or a flu-like illness",
            "Dehydration-related headache with fever",
            "Migraine or tension-type headache happening along with fever symptoms",
        ]

    if "headache" in symptoms and any(token in normalized_text for token in ["sudden", "suddenly"]):
        return [
            "Sudden severe headache that needs same-day medical review",
            "Migraine pattern",
            "Blood-pressure or neurological cause that should be checked clinically",
        ]

    conditions = list(context.get("possible_conditions") or [])
    if conditions:
        return conditions[:3]

    if symptoms:
        return [f"Symptoms may fit common causes related to {', '.join(symptoms[:2])}."]
    return ["Not enough symptom detail yet to suggest likely common causes."]


def _safe_general_advice(extracted: dict[str, Any], context: dict[str, Any], risk: dict[str, Any]) -> list[str]:
    symptoms = extracted.get("symptoms") or []
    normalized_text = extracted.get("normalized_text", "")

    if risk.get("priority_emergency"):
        return [
            "Please do not rely on chat-only guidance for this symptom pattern.",
            "Have someone stay with you if you feel weak, dizzy, or unsafe.",
        ]

    if "fever" in symptoms and "headache" in symptoms:
        return [
            "Rest, drink plenty of water or oral fluids, and avoid overexertion today.",
            "Check your temperature again later and note whether the fever is improving or climbing.",
            "Try light food, reduce screen strain, and arrange a same-day review if the headache is getting stronger.",
        ]

    if "headache" in symptoms and any(token in normalized_text for token in ["sudden", "suddenly"]):
        return [
            "Do not ignore a sudden headache if it feels unusual or stronger than your usual headaches.",
            "Avoid driving yourself if you feel weak, dizzy, or visually uncomfortable.",
            "Get a clinician review today, especially if the pain is severe or keeps escalating.",
        ]

    advice = list(context.get("general_advice") or [])
    if advice:
        return advice[:3]

    symptom_text = ", ".join((extracted.get("symptoms") or [])[:2]) or "these symptoms"
    return [
        f"Rest, sip fluids, and avoid anything that seems to worsen {symptom_text}.",
        "Keep note of when this started and whether it is improving or worsening.",
    ]


def _canonical_follow_up_key(question: str) -> str:
    lowered = question.lower()
    if "sudden" in lowered or "gradual" in lowered:
        return "onset_pattern"
    if "nausea" in lowered or "light sensitivity" in lowered or "vision changes" in lowered or "light makes it worse" in lowered:
        return "migraine_associated"
    if "how long" in lowered or "duration" in lowered:
        return "duration"
    return re.sub(r"[^a-z0-9]+", " ", lowered).strip()


def _question_is_answered(question: str, extracted: dict[str, Any]) -> bool:
    lowered_question = question.lower()
    normalized_text = extracted.get("normalized_text", "")

    if ("sudden" in lowered_question or "gradual" in lowered_question) and any(
        token in normalized_text for token in ["sudden", "suddenly", "gradual", "gradually"]
    ):
        return True

    if "how long" in lowered_question and extracted.get("duration"):
        return True

    if ("nausea" in lowered_question and "nausea" in normalized_text) or (
        "vision changes" in lowered_question and "vision" in normalized_text
    ):
        return True

    return False


def _safe_follow_up_questions(extracted: dict[str, Any], context: dict[str, Any], follow_up_questions: Optional[list[str]]) -> list[str]:
    questions: list[str] = []
    seen_keys: set[str] = set()
    for question in follow_up_questions or []:
        canonical = _canonical_follow_up_key(question)
        if canonical in seen_keys or _question_is_answered(question, extracted):
            continue
        seen_keys.add(canonical)
        if question not in questions:
            questions.append(question)
    for question in context.get("follow_up_questions") or []:
        canonical = _canonical_follow_up_key(question)
        if canonical in seen_keys or _question_is_answered(question, extracted):
            continue
        seen_keys.add(canonical)
        if question not in questions:
            questions.append(question)

    if questions:
        return questions[:3]

    if _normalize_text(extracted.get("raw_text", "")) in GREETING_MESSAGES:
        return ["Tell me your main symptom, how long it has been there, and what feels worst right now."]

    if not extracted.get("duration"):
        return ["How long have these symptoms been present?"]
    return ["No more follow-up questions right now."]


def _safe_recommended_action(extracted: dict[str, Any], risk: dict[str, Any]) -> list[str]:
    symptoms = extracted.get("symptoms") or []
    normalized_text = extracted.get("normalized_text", "")

    if risk.get("priority_emergency"):
        return [
            risk.get("recommended_action") or "Seek urgent in-person care immediately.",
            "If symptoms are active now, call local emergency services or go to the nearest hospital.",
        ]

    if "headache" in symptoms and any(token in normalized_text for token in ["sudden", "suddenly"]):
        return [
            "Arrange same-day medical review instead of only monitoring this at home.",
            "Go urgently sooner if this is the worst headache you have had or if new weakness, confusion, vomiting, or vision changes appear.",
        ]

    if "fever" in symptoms and "headache" in symptoms:
        return [
            "Monitor closely today and arrange a same-day appointment if the fever or headache is worsening, not settling, or if you feel significantly weaker.",
        ]

    return [
        risk.get("recommended_action") or "Monitor your symptoms and arrange a same-day review if they persist.",
    ]


def _safe_emergency_warning(extracted: dict[str, Any], context: dict[str, Any]) -> list[str]:
    symptoms = extracted.get("symptoms") or []
    normalized_text = extracted.get("normalized_text", "")

    if "fever" in symptoms and "headache" in symptoms:
        return [
            "Get urgent help if you develop confusion, a stiff neck, repeated vomiting, breathing trouble, or become very drowsy.",
            "Get urgent help if the headache becomes suddenly severe or you faint, seize, or have major vision changes.",
        ]

    if "headache" in symptoms and any(token in normalized_text for token in ["sudden", "suddenly"]):
        return [
            "Get urgent help now if this is the worst headache you have had, or if it comes with weakness, confusion, fainting, seizures, or major vision changes.",
        ]

    return context.get("emergency_warning") or [
        "Get urgent help if symptoms become severe, you have breathing trouble, chest pain, confusion, or fainting.",
    ]


def _render_structured_response(
    *,
    user_message: str,
    extracted: dict[str, Any],
    risk: dict[str, Any],
    context: dict[str, Any],
    follow_up_questions: Optional[list[str]] = None,
) -> str:
    symptoms = extracted.get("symptoms") or []
    duration = extracted.get("duration") or "not clearly stated"
    severity = extracted.get("severity") or "unspecified"
    symptoms_summary = [
        f"Reported concern: {', '.join(symptoms[:3]) or 'general symptoms'}; duration: {duration}; severity hint: {severity}.",
    ]

    recommended_action = _safe_recommended_action(extracted, risk)
    emergency_warning = _safe_emergency_warning(extracted, context)

    sections = [
        _format_section("Symptoms Summary", symptoms_summary),
        _format_section("Follow-up Questions", _safe_follow_up_questions(extracted, context, follow_up_questions)),
        _format_section("Possible Conditions", _safe_possible_conditions(extracted, context)),
        _format_section("Risk Level", [f"{risk.get('risk_flag', 'MODERATE')} ({risk.get('triage_label', 'Medium')})"]),
        _format_section("Recommended Action", recommended_action),
        _format_section("General Advice", _safe_general_advice(extracted, context, risk)),
        _format_section("Emergency Warning", emergency_warning),
    ]
    return "\n\n".join([*sections, DISCLAIMER_LINE])


def _build_structured_prompt(
    user_message: str,
    *,
    extracted: dict[str, Any],
    risk: dict[str, Any],
    context: dict[str, Any],
    patient_context: Optional[dict[str, Any]],
    recent_user_messages: Optional[list[str]],
    follow_up_questions: Optional[list[str]],
    language_preference: Optional[str],
) -> str:
    return f"""
You are Medicare Excellence, a structured medical triage assistant for patients.

Your job is to act like a modern healthcare triage AI:
- understand the complaint
- ask focused follow-up only when useful
- use risk-aware reasoning
- stay practical and easy to understand
- do NOT prescribe medications or doses
- do NOT invent lab results, prescriptions, or diagnosis certainty

Always use the exact markdown section titles below:
**Symptoms Summary**
**Follow-up Questions**
**Possible Conditions**
**Risk Level**
**Recommended Action**
**General Advice**
**Emergency Warning**

Hard rules:
- Risk Level must stay aligned with this engine output: {risk.get('risk_flag', 'MODERATE')} ({risk.get('triage_label', 'Medium')})
- If risk is HIGH, prioritize emergency care and do not sound casual.
- Mention only broad possible conditions, never final diagnosis.
- Never suggest exact medicine names, dosages, or treatment plans unless they are already explicitly present in trusted context. If uncertain, say to consult a clinician.
- Keep the reply concise, clear, and patient-friendly.
- Add this exact final line: {DISCLAIMER_LINE}

Conversation memory (last user messages, newest last):
{json.dumps(recent_user_messages or [], ensure_ascii=False)}

Patient profile context:
{_build_patient_context_note(patient_context) or "No important prior profile context."}

Input processing output:
- Normalized text: {extracted.get('normalized_text', '')}
- Symptoms: {json.dumps(extracted.get('symptoms') or [], ensure_ascii=False)}
- Duration: {extracted.get('duration') or 'not clearly stated'}
- Severity hint: {extracted.get('severity') or 'unspecified'}
- Body parts: {json.dumps(extracted.get('body_parts') or [], ensure_ascii=False)}
- Red flags: {json.dumps(extracted.get('red_flags') or [], ensure_ascii=False)}

Triage engine output:
- Triage label: {risk.get('triage_label', 'Medium')}
- Risk flag: {risk.get('risk_flag', 'MODERATE')}
- Triage reason: {risk.get('triage_reason', '')}
- Recommended action baseline: {risk.get('recommended_action', '')}

Retrieved medical context:
- Context snippets: {json.dumps(context.get('context_snippets') or [], ensure_ascii=False)}
- Possible conditions from retrieval: {json.dumps(context.get('possible_conditions') or [], ensure_ascii=False)}
- General advice from retrieval: {json.dumps(context.get('general_advice') or [], ensure_ascii=False)}
- Emergency warnings from retrieval: {json.dumps(context.get('emergency_warning') or [], ensure_ascii=False)}
- Suggested follow-up questions: {json.dumps(_safe_follow_up_questions(extracted, context, follow_up_questions), ensure_ascii=False)}

Preferred language:
{language_preference or "Same as the user message"}

User message:
{user_message}
""".strip()


def _call_huggingface_llm(prompt: str) -> str:
    token = os.getenv("HF_TOKEN") or os.getenv("HUGGINGFACEHUB_API_TOKEN")
    if not token:
        return ""

    try:
        response = requests.post(
            "https://router.huggingface.co/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json",
            },
            json={
                "model": os.getenv("HF_TEXT_MODEL", HF_DEFAULT_TEXT_MODEL),
                "messages": [
                    {
                        "role": "system",
                        "content": "You are a safe patient triage assistant. Stay structured, practical, and conservative.",
                    },
                    {"role": "user", "content": prompt},
                ],
                "max_tokens": 420,
                "temperature": 0.25,
            },
            timeout=45,
        )
        response.raise_for_status()
        payload = response.json()
        choices = payload.get("choices") or []
        if not choices:
            return ""
        return str((choices[0].get("message") or {}).get("content") or "").strip()
    except Exception:
        return ""


def _call_gemini_llm(prompt: str) -> str:
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key or genai is None:
        return ""

    try:
        genai.configure(api_key=api_key)
        model = genai.GenerativeModel("models/gemini-2.5-flash")
        response = model.generate_content(prompt)
        return (response.text or "").strip()
    except Exception:
        return ""


def _response_has_required_sections(response_text: str) -> bool:
    normalized = response_text or ""
    return all(f"**{section}**" in normalized for section in REQUIRED_SECTIONS)


def _ensure_disclaimer(response_text: str) -> str:
    if DISCLAIMER_LINE in response_text:
        return response_text
    return f"{response_text.rstrip()}\n\n{DISCLAIMER_LINE}"


def generate_ai_response(
    user_message: str,
    *,
    extracted: dict[str, Any],
    risk: dict[str, Any],
    medical_context: dict[str, Any],
    patient_context: Optional[dict[str, Any]] = None,
    recent_user_messages: Optional[list[str]] = None,
    follow_up_questions: Optional[list[str]] = None,
    language_preference: Optional[str] = None,
) -> str:
    """LLM layer with a structured prompt and deterministic fallback."""
    fallback_response = _render_structured_response(
        user_message=user_message,
        extracted=extracted,
        risk=risk,
        context=medical_context,
        follow_up_questions=follow_up_questions,
    )

    # High-risk cases are intentionally deterministic so the warning is never softened by the model.
    if risk.get("priority_emergency"):
        return fallback_response

    prompt = _build_structured_prompt(
        user_message,
        extracted=extracted,
        risk=risk,
        context=medical_context,
        patient_context=patient_context,
        recent_user_messages=recent_user_messages,
        follow_up_questions=follow_up_questions,
        language_preference=language_preference,
    )

    llm_response = _call_huggingface_llm(prompt) or _call_gemini_llm(prompt)
    if not llm_response or not _response_has_required_sections(llm_response):
        return fallback_response

    return _ensure_disclaimer(llm_response)


def get_ai_response(
    user_message: str,
    language_preference: Optional[str] = None,
    *,
    triage: Optional[dict[str, Any]] = None,
    entities: Optional[dict[str, Any]] = None,
    patient_context: Optional[dict[str, Any]] = None,
    recent_user_messages: Optional[list[str]] = None,
    follow_up_questions: Optional[list[str]] = None,
) -> str:
    """
    Public entry point kept for backward compatibility with the current backend.
    Internally this now runs a 3-layer triage assistant with lightweight retrieval.
    """
    extracted = extract_symptoms(user_message)
    if entities:
        extracted["entities"] = entities
        extracted["symptoms"] = entities.get("symptoms") or extracted["symptoms"]
        extracted["body_parts"] = entities.get("body_parts") or extracted["body_parts"]
        extracted["red_flags"] = entities.get("red_flags") or extracted["red_flags"]
        extracted["medications_mentioned"] = entities.get("medications_mentioned") or extracted["medications_mentioned"]
        extracted["duration"] = entities.get("duration_text") or extracted["duration"]

    risk = dict(triage or detect_risk(user_message, extracted))
    if "risk_flag" not in risk:
        risk.update(detect_risk(user_message, extracted))

    medical_context = retrieve_medical_context(extracted)
    return generate_ai_response(
        user_message,
        extracted=extracted,
        risk=risk,
        medical_context=medical_context,
        patient_context=patient_context,
        recent_user_messages=recent_user_messages,
        follow_up_questions=follow_up_questions,
        language_preference=language_preference,
    )
