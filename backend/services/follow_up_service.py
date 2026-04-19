from typing import Any


FOLLOW_UP_RULES = {
    "chest pain": [
        "When did the chest pain start?",
        "Does the pain spread to your arm, back, jaw, or shoulder?",
        "Are you also having sweating, dizziness, or nausea?",
    ],
    "shortness of breath": [
        "Did the breathing trouble start suddenly or build up gradually?",
        "Is it worse when walking, lying down, or speaking?",
        "Do you also have wheezing, chest tightness, or fever?",
    ],
    "fever": [
        "What temperature have you recorded, if any?",
        "Have you also had chills or body aches?",
        "How many days has the fever been present?",
    ],
    "headache": [
        "Did the headache begin suddenly or gradually?",
        "Do you also have nausea, light sensitivity, or vision changes?",
        "Is this the worst headache you have had?",
    ],
    "cough": [
        "Is the cough dry or bringing up mucus?",
        "Do you also have fever, sore throat, or shortness of breath?",
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

    return questions[:2]


def get_follow_up_intro(*, emergency: bool = False) -> str:
    if emergency:
        return "If you can answer safely while getting help, these details would help the care team:"
    return "To guide you better, please tell me:"
