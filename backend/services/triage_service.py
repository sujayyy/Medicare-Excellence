from typing import Any, Optional

from services.memory_service import build_semantic_embedding_profile, semantic_similarity_from_profiles
from services.symptom_extraction_service import extract_symptom_entities


RISK_PROTOTYPES = {
    "Critical": {
        "prototype": (
            "cannot breathe stopped breathing severe chest pain stroke seizure unconscious heavy bleeding "
            "suicidal severe emergency collapse left arm sweating confusion"
        ),
        "recommended_action": "Seek immediate emergency care and alert hospital staff now.",
    },
    "High": {
        "prototype": (
            "chest pain shortness of breath difficulty breathing fainting blood in vomit blood in urine "
            "vomiting dehydration high fever blurred vision weakness urgent review today"
        ),
        "recommended_action": "Arrange urgent in-person evaluation as soon as possible today.",
    },
    "Medium": {
        "prototype": (
            "headache fever cough dizziness nausea abdominal pain rash back pain blood pressure fatigue "
            "same day follow-up monitor symptoms"
        ),
        "recommended_action": "Monitor symptoms closely and consider a same-day appointment if they persist.",
    },
    "Low": {
        "prototype": (
            "mild symptom general question routine follow-up appointment scheduling monitoring stable"
        ),
        "recommended_action": "Continue monitoring symptoms and use the assistant if anything changes.",
    },
}


CRITICAL_PHRASES = {
    "can't breathe": 38,
    "cannot breathe": 38,
    "stopped breathing": 42,
    "severe chest pain": 34,
    "stroke": 34,
    "seizure": 34,
    "unconscious": 40,
    "suicidal": 42,
    "heavy bleeding": 34,
}

HIGH_RISK_PHRASES = {
    "chest pain": 20,
    "shortness of breath": 22,
    "difficulty breathing": 22,
    "fainting": 22,
    "blood in vomit": 22,
    "blood in urine": 18,
    "high fever": 14,
    "vomiting": 10,
    "blurred vision": 12,
    "weakness": 12,
}

MEDIUM_RISK_PHRASES = {
    "headache": 9,
    "fever": 9,
    "cough": 7,
    "dizziness": 9,
    "nausea": 8,
    "abdominal pain": 10,
    "rash": 7,
    "back pain": 7,
    "blood pressure": 9,
    "fatigue": 6,
    "anxiety": 6,
}

URGENT_RED_FLAGS = {
    "chest pain",
    "shortness of breath",
    "difficulty breathing",
    "fainting",
    "unconscious",
    "seizure",
    "heavy bleeding",
    "blood in vomit",
    "blood in urine",
    "stroke",
}

SEVERITY_ACTIONS = {
    "Critical": "Seek immediate emergency care and alert hospital staff now.",
    "High": "Arrange urgent in-person evaluation as soon as possible today.",
    "Medium": "Monitor symptoms closely and consider a same-day appointment if they persist.",
    "Low": "Continue monitoring symptoms and use the assistant if anything changes.",
}

def _score_from_phrases(message: str, phrase_weights: dict[str, int]) -> tuple[int, list[str]]:
    score = 0
    matched: list[str] = []
    for phrase, weight in phrase_weights.items():
        if phrase in message:
            score += weight
            matched.append(phrase)
    return score, matched


def _semantic_risk_scores(message: str, entities: dict[str, Any]) -> dict[str, float]:
    query_profile = build_semantic_embedding_profile(
        message,
        entities=entities,
        task_type="retrieval_query",
    )
    scores: dict[str, float] = {}
    for label, profile in RISK_PROTOTYPES.items():
        prototype_profile = build_semantic_embedding_profile(
            profile["prototype"],
            task_type="retrieval_document",
        )
        scores[label] = round(
            max(
                semantic_similarity_from_profiles(
                    query_profile,
                    prototype_profile,
                    left_text=message,
                    right_text=profile["prototype"],
                    left_entities=entities,
                ),
                0.0,
            ),
            4,
        )
    return scores


def _duration_risk_bonus(duration_text: str) -> tuple[int, Optional[str]]:
    normalized = (duration_text or "").lower()
    if not normalized:
        return 0, None
    if any(token in normalized for token in ["week", "weeks", "month", "months"]):
        return 8, "Symptoms have been present for an extended duration."
    if any(token in normalized for token in ["day", "days"]) and "2 day" in normalized:
        return 5, "Symptoms have persisted for multiple days."
    return 2, "The symptom duration adds some clinical concern."


def _score_entities(entities: dict[str, Any]) -> tuple[int, list[str]]:
    score = 0
    reasons: list[str] = []

    symptoms = entities.get("symptoms") or []
    red_flags = entities.get("red_flags") or []
    body_parts = entities.get("body_parts") or []

    if red_flags:
        score += min(26, len(red_flags) * 10)
        reasons.append(f"Red-flag findings detected: {', '.join(red_flags[:3])}.")

    if len(symptoms) >= 3:
        score += 9
        reasons.append("Multiple symptoms were reported together.")
    elif len(symptoms) == 2:
        score += 5

    if "left arm" in body_parts and "chest pain" in symptoms:
        score += 15
        reasons.append("Chest pain with left arm involvement raises cardiac concern.")

    if "head" in body_parts and ("blurred vision" in symptoms or "dizziness" in symptoms):
        score += 8
        reasons.append("Head symptoms with vision or dizziness raise neurological concern.")

    duration_bonus, duration_reason = _duration_risk_bonus(entities.get("duration_text") or "")
    score += duration_bonus
    if duration_reason:
        reasons.append(duration_reason)

    return score, reasons


def _label_from_score(score: int, *, appointment: bool = False) -> str:
    if appointment and score < 40:
        return "Low"
    if score >= 85:
        return "Critical"
    if score >= 62:
        return "High"
    if score >= 35:
        return "Medium"
    return "Low"


def _recommended_action(label: str, *, appointment: bool = False) -> str:
    if appointment and label == "Low":
        return "Proceed with routine scheduling and monitor for new symptoms."
    return SEVERITY_ACTIONS.get(label, SEVERITY_ACTIONS["Low"])


def _reason_from_factors(label: str, factors: list[str]) -> str:
    if factors:
        return " ".join(factors[:3])
    if label == "Low":
        return "No strong urgent symptom signals were detected in the latest message."
    return f"The AI triage model classified this message as {label.lower()} risk based on the symptom pattern."


def _confidence_band(confidence: float) -> str:
    if confidence >= 0.88:
        return "High"
    if confidence >= 0.72:
        return "Moderate"
    return "Emerging"


def assess_triage(
    user_message: str,
    *,
    emergency: bool = False,
    appointment: bool = False,
    entities: Optional[dict[str, Any]] = None,
) -> dict[str, Any]:
    message = (user_message or "").strip().lower()
    entities = entities or extract_symptom_entities(user_message)

    if emergency:
        return {
            "triage_score": 95,
            "triage_label": "Critical",
            "triage_reason": "The message was explicitly classified as an emergency request.",
            "recommended_action": SEVERITY_ACTIONS["Critical"],
            "triage_model": "transformer-semantic-triage-v3",
            "triage_confidence": 0.99,
            "triage_factors": ["Emergency intent was explicitly detected."],
            "triage_evidence": {
                "semantic_anchor": "Emergency intent override",
                "confidence_band": "High",
                "matched_red_flags": entities.get("red_flags") or [],
                "top_symptoms": entities.get("symptoms") or [],
            },
        }

    critical_score, critical_matches = _score_from_phrases(message, CRITICAL_PHRASES)
    high_score, high_matches = _score_from_phrases(message, HIGH_RISK_PHRASES)
    medium_score, medium_matches = _score_from_phrases(message, MEDIUM_RISK_PHRASES)
    entity_score, entity_reasons = _score_entities(entities)
    semantic_scores = _semantic_risk_scores(message, entities)

    score = 12
    factors: list[str] = []

    score += critical_score + high_score + medium_score + entity_score
    if critical_matches:
        factors.append(f"Critical phrases detected: {', '.join(critical_matches[:3])}.")
    if high_matches:
        factors.append(f"High-risk phrases detected: {', '.join(high_matches[:3])}.")
    if medium_matches and not high_matches and not critical_matches:
        factors.append(f"Moderate-risk symptoms detected: {', '.join(medium_matches[:3])}.")
    factors.extend(entity_reasons)

    semantic_top_label = max(semantic_scores, key=semantic_scores.get)
    semantic_top_score = semantic_scores[semantic_top_label]
    score += round(semantic_top_score * 26)
    if semantic_top_score >= 0.18:
        factors.append(f"Semantic triage match strongest for {semantic_top_label.lower()} risk.")

    if appointment and score < 40 and not entities.get("red_flags"):
        factors = ["This message appears to be appointment-related without urgent symptom language."]
        return {
            "triage_score": 30,
            "triage_label": "Low",
            "triage_reason": factors[0],
            "recommended_action": _recommended_action("Low", appointment=True),
            "triage_model": "transformer-semantic-triage-v3",
            "triage_confidence": 0.82,
            "triage_factors": factors,
            "triage_evidence": {
                "semantic_anchor": "Appointment scheduling pattern",
                "confidence_band": "Moderate",
                "matched_red_flags": [],
                "top_symptoms": entities.get("symptoms") or [],
            },
        }

    urgent_red_flags = [flag for flag in (entities.get("red_flags") or []) if flag in URGENT_RED_FLAGS]
    if urgent_red_flags and score < 62:
        score = 62
        factors.append("Urgent red-flag symptoms prevent this case from being treated as low risk.")

    label = _label_from_score(score, appointment=appointment)
    confidence = min(0.99, 0.55 + (score / 160))

    if label == "Critical" and not critical_matches and urgent_red_flags:
        factors.append("Critical severity was raised due to clustered red-flag findings.")

    return {
        "triage_score": min(score, 99),
        "triage_label": label,
        "triage_reason": _reason_from_factors(label, factors),
        "recommended_action": _recommended_action(label, appointment=appointment),
        "triage_model": "transformer-semantic-triage-v3",
        "triage_confidence": round(confidence, 2),
        "triage_factors": factors[:5],
        "semantic_risk_scores": semantic_scores,
        "triage_evidence": {
            "semantic_anchor": f"Strongest semantic match: {semantic_top_label}",
            "confidence_band": _confidence_band(confidence),
            "matched_red_flags": entities.get("red_flags") or [],
            "top_symptoms": entities.get("symptoms") or [],
            "prototype_scores": semantic_scores,
        },
    }
