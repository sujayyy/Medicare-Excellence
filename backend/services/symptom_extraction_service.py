import re
from typing import Any


SYMPTOM_PATTERNS = [
    "chest pain",
    "shortness of breath",
    "difficulty breathing",
    "headache",
    "blurred vision",
    "fever",
    "cough",
    "dizziness",
    "vertigo",
    "nausea",
    "vomiting",
    "abdominal pain",
    "back pain",
    "joint pain",
    "knee pain",
    "neck pain",
    "itching",
    "anxiety",
    "palpitation",
    "sore throat",
    "fatigue",
    "rash",
    "palpitations",
    "blood in urine",
    "heavy bleeding",
]

BODY_PART_PATTERNS = [
    "chest",
    "head",
    "left arm",
    "right arm",
    "arm",
    "leg",
    "stomach",
    "abdomen",
    "back",
    "throat",
    "neck",
    "eye",
    "ear",
    "nose",
    "pelvis",
    "joint",
    "knee",
]

MEDICATION_PATTERNS = [
    "paracetamol",
    "acetaminophen",
    "ibuprofen",
    "aspirin",
    "amoxicillin",
    "metformin",
    "insulin",
    "omeprazole",
    "cetirizine",
    "thyroxine",
    "amlodipine",
    "losartan",
]

RED_FLAG_PATTERNS = [
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
]

DURATION_PATTERNS = [
    r"for\s+\d+\s+(?:hour|hours|day|days|week|weeks|month|months)",
    r"since\s+(?:yesterday|last night|this morning|today)",
    r"\d+\s+(?:hour|hours|day|days|week|weeks|month|months)\s+ago",
]


def _matches_from_patterns(message: str, patterns: list[str]) -> list[str]:
    found: list[str] = []
    for pattern in patterns:
        if pattern in message and pattern not in found:
            found.append(pattern)
    return found


def _extract_duration(message: str) -> str:
    for pattern in DURATION_PATTERNS:
        match = re.search(pattern, message, re.IGNORECASE)
        if match:
            return match.group(0).strip()
    return ""


def extract_symptom_entities(user_message: str) -> dict[str, Any]:
    message = (user_message or "").strip().lower()

    symptoms = _matches_from_patterns(message, SYMPTOM_PATTERNS)
    body_parts = _matches_from_patterns(message, BODY_PART_PATTERNS)
    medications = _matches_from_patterns(message, MEDICATION_PATTERNS)
    red_flags = _matches_from_patterns(message, RED_FLAG_PATTERNS)
    duration_text = _extract_duration(message)

    return {
        "symptoms": symptoms,
        "duration_text": duration_text,
        "body_parts": body_parts,
        "medications_mentioned": medications,
        "red_flags": red_flags,
    }
