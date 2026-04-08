from typing import Any


FOLLOW_UP_RULES = {
    "chest pain": [
        "When did the chest pain start, and is it constant or intermittent?",
        "Does the pain spread to your arm, back, jaw, or shoulder?",
        "Do you feel sweating, dizziness, or nausea along with it?",
    ],
    "shortness of breath": [
        "Did the breathing difficulty start suddenly or build up gradually?",
        "Is it worse when walking, lying down, or speaking?",
        "Have you had wheezing, chest tightness, or a recent fever?",
    ],
    "fever": [
        "What temperature have you recorded, if any?",
        "Have you had chills, body aches, or exposure to anyone ill recently?",
        "How many days has the fever been present?",
    ],
    "headache": [
        "Is the headache one-sided, pressure-like, or the worst headache you have had?",
        "Do you have sensitivity to light, nausea, or vision changes?",
        "Did it begin suddenly or gradually?",
    ],
    "cough": [
        "Is the cough dry or producing mucus?",
        "Have you noticed fever, sore throat, or shortness of breath with it?",
        "How long has the cough been going on?",
    ],
    "back pain": [
        "Did the back pain start after lifting, injury, or without a clear cause?",
        "Does the pain travel down the leg or cause numbness?",
        "What movements make it worse or better?",
    ],
}


def generate_follow_up_questions(
    *,
    entities: dict[str, Any],
    triage: dict[str, Any],
    appointment: bool = False,
    emergency: bool = False,
) -> list[str]:
    if appointment:
        return []

    symptoms = entities.get("symptoms") or []
    red_flags = entities.get("red_flags") or []
    questions: list[str] = []

    for symptom in [*red_flags, *symptoms]:
        for question in FOLLOW_UP_RULES.get(symptom, []):
            if question not in questions:
                questions.append(question)
        if len(questions) >= 3:
            break

    if not questions and triage.get("triage_label") in {"Medium", "High", "Critical"}:
        questions = [
            "How long have these symptoms been present?",
            "Have the symptoms been getting worse, staying the same, or improving?",
            "Have you taken any medication or checked any vitals related to this issue?",
        ]

    return questions[:3]


def get_follow_up_intro(*, emergency: bool = False) -> str:
    if emergency:
        return "If you can answer safely while getting help, these details may be useful:"
    return "A few quick questions that would help narrow this down:"
