from typing import Any


TRIAGE_RULES = [
    {
        "label": "Critical",
        "score": 95,
        "recommended_action": "Seek immediate emergency care and alert hospital staff now.",
        "patterns": [
            ("can't breathe", "Breathing difficulty can become life-threatening quickly."),
            ("cannot breathe", "Breathing difficulty can become life-threatening quickly."),
            ("stopped breathing", "Loss of breathing requires emergency response."),
            ("severe chest pain", "Severe chest pain may indicate a cardiac emergency."),
            ("stroke", "Stroke symptoms require urgent intervention."),
            ("seizure", "Seizure-like symptoms require immediate medical review."),
            ("unconscious", "Loss of consciousness is a critical emergency sign."),
            ("suicidal", "Self-harm risk requires immediate crisis support."),
            ("heavy bleeding", "Heavy bleeding can become dangerous quickly."),
        ],
    },
    {
        "label": "High",
        "score": 75,
        "recommended_action": "Arrange urgent in-person evaluation as soon as possible today.",
        "patterns": [
            ("chest pain", "Chest pain should be evaluated urgently."),
            ("shortness of breath", "Breathing-related symptoms raise urgent concern."),
            ("difficulty breathing", "Breathing-related symptoms raise urgent concern."),
            ("fainting", "Fainting can indicate a serious underlying issue."),
            ("blood in vomit", "Vomiting blood needs urgent review."),
            ("blood in urine", "Visible blood may indicate an urgent issue."),
            ("vomiting", "Persistent vomiting can cause dehydration and complications."),
            ("dehydration", "Dehydration may worsen quickly without treatment."),
            ("high fever", "High fever may signal infection requiring urgent care."),
        ],
    },
    {
        "label": "Medium",
        "score": 45,
        "recommended_action": "Monitor symptoms closely and consider a same-day appointment if they persist.",
        "patterns": [
            ("headache", "Headache symptoms should be monitored, especially if persistent."),
            ("fever", "Fever may indicate infection and should be monitored."),
            ("cough", "Cough symptoms may need follow-up if persistent."),
            ("dizziness", "Dizziness should be reviewed if it recurs or worsens."),
            ("nausea", "Nausea may need follow-up if it persists."),
            ("abdominal pain", "Abdominal pain should be monitored for severity changes."),
            ("rash", "Skin rashes may need clinical review if spreading or painful."),
            ("back pain", "Pain symptoms may benefit from follow-up if ongoing."),
            ("blood pressure", "Blood pressure concerns should be reviewed and tracked."),
        ],
    },
]


def assess_triage(user_message: str, *, emergency: bool = False, appointment: bool = False) -> dict[str, Any]:
    message = (user_message or "").strip().lower()

    if emergency:
        return {
            "triage_score": 95,
            "triage_label": "Critical",
            "triage_reason": "The message was classified as an emergency request.",
            "recommended_action": "Seek immediate emergency care and alert hospital staff now.",
        }

    for rule in TRIAGE_RULES:
        for phrase, reason in rule["patterns"]:
            if phrase in message:
                return {
                    "triage_score": rule["score"],
                    "triage_label": rule["label"],
                    "triage_reason": reason,
                    "recommended_action": rule["recommended_action"],
                }

    if appointment:
        return {
            "triage_score": 30,
            "triage_label": "Low",
            "triage_reason": "This message appears to be appointment-related without urgent symptom language.",
            "recommended_action": "Proceed with routine scheduling and monitor for new symptoms.",
        }

    return {
        "triage_score": 20,
        "triage_label": "Low",
        "triage_reason": "No urgent symptom keywords were detected in the latest message.",
        "recommended_action": "Continue monitoring symptoms and use the assistant if anything changes.",
    }
