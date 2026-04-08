from typing import Any, Optional


SPECIALTY_LABELS = {
    "general_medicine": "General Medicine",
    "cardiology": "Cardiology",
    "pulmonology": "Pulmonology",
    "neurology": "Neurology",
    "endocrinology": "Endocrinology",
}


SPECIALTY_PATTERNS = {
    "cardiology": [
        "chest pain",
        "palpitation",
        "heart",
        "cardiac",
        "blood pressure",
        "hypertension",
        "left arm",
    ],
    "pulmonology": [
        "shortness of breath",
        "breathing",
        "asthma",
        "wheezing",
        "cough",
        "lung",
        "oxygen",
    ],
    "neurology": [
        "headache",
        "migraine",
        "seizure",
        "stroke",
        "dizziness",
        "numbness",
        "tingling",
    ],
    "endocrinology": [
        "glucose",
        "diabetes",
        "sugar",
        "thyroid",
        "insulin",
        "hormone",
    ],
}


def get_specialty_label(specialty: Optional[str]) -> str:
    normalized = (specialty or "general_medicine").strip().lower()
    return SPECIALTY_LABELS.get(normalized, "General Medicine")


def infer_specialty(*, user_message: str = "", entities: Optional[dict[str, Any]] = None) -> str:
    entities = entities or {}
    haystack = " ".join(
        [
            user_message or "",
            " ".join(entities.get("symptoms") or []),
            " ".join(entities.get("red_flags") or []),
            " ".join(entities.get("body_parts") or []),
            " ".join(entities.get("medications_mentioned") or []),
        ]
    ).lower()

    for specialty, patterns in SPECIALTY_PATTERNS.items():
        if any(pattern in haystack for pattern in patterns):
            return specialty
    return "general_medicine"
