from typing import Any, Optional


SPECIALTY_LABELS = {
    "general_medicine": "General Medicine",
    "cardiology": "Cardiology",
    "pulmonology": "Pulmonology",
    "neurology": "Neurology",
    "endocrinology": "Endocrinology",
    "dermatology": "Dermatology",
    "orthopedics": "Orthopedics",
    "pediatrics": "Pediatrics",
    "psychiatry": "Psychiatry",
    "ent": "ENT",
    "gynecology": "Gynecology",
    "gastroenterology": "Gastroenterology",
    "nephrology": "Nephrology",
    "oncology": "Oncology",
    "ophthalmology": "Ophthalmology",
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

    scores = {
        specialty: sum(1 for pattern in patterns if pattern in haystack)
        for specialty, patterns in SPECIALTY_PATTERNS.items()
    }

    if scores["neurology"] > 0 and scores["cardiology"] == 0:
        return "neurology"
    if scores["pulmonology"] > 0 and scores["cardiology"] == 0:
        return "pulmonology"

    best_specialty = max(scores, key=scores.get)
    if scores[best_specialty] <= 0:
        return "general_medicine"
    return best_specialty
