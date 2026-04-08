import os

try:
    import google.generativeai as genai
except Exception:  # pragma: no cover - optional dependency path
    genai = None


FALLBACK_RESPONSES = {
    "headache": {
        "causes": "dehydration, stress, viral infection, or migraine",
        "precautions": "drink water, rest in a quiet room, and monitor for worsening pain or vision changes",
        "severity": "Medium",
    },
    "fever": {
        "causes": "viral illness, bacterial infection, or inflammation",
        "precautions": "stay hydrated, rest, and seek care if the fever remains high or lasts more than two days",
        "severity": "Medium",
    },
    "cough": {
        "causes": "cold, flu, allergies, or airway irritation",
        "precautions": "use warm fluids, rest, and monitor for breathing difficulty",
        "severity": "Low",
    },
    "chest pain": {
        "causes": "muscle strain, acid reflux, or a heart-related condition",
        "precautions": "avoid exertion and seek urgent in-person care immediately",
        "severity": "High",
    },
    "blood pressure": {
        "causes": "stress, lifestyle factors, medication issues, or chronic hypertension",
        "precautions": "reduce salt intake, stay calm, and check a current blood pressure reading if available",
        "severity": "Medium",
    },
}


def _fallback_response(user_message: str) -> str:
    message = user_message.lower()
    guidance = next((value for key, value in FALLBACK_RESPONSES.items() if key in message), None)

    if not guidance:
        return (
            "Possible causes: common viral illness, inflammation, or another non-emergency condition.\n\n"
            "Precautions: rest, stay hydrated, avoid self-medicating beyond basic OTC care, and monitor for worsening symptoms.\n\n"
            "Severity: Medium\n\n"
            "If symptoms are severe, persistent, or rapidly worsening, please contact a licensed clinician."
        )

    return (
        f"Possible causes: {guidance['causes']}.\n\n"
        f"Precautions: {guidance['precautions']}.\n\n"
        f"Severity: {guidance['severity']}\n\n"
        "This is supportive guidance only and not a medical diagnosis."
    )


def get_ai_response(user_message: str) -> str:
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key or genai is None:
        return _fallback_response(user_message)

    try:
        genai.configure(api_key=api_key)
        model = genai.GenerativeModel("models/gemini-2.5-flash")
        response = model.generate_content(
            f"""
You are a careful medical assistant for Medicare Excellence.

Reply with:
- Possible causes
- Precautions
- Severity (Low/Medium/High)
- A brief note that emergency symptoms require in-person care

User: {user_message}
"""
        )

        return response.text or _fallback_response(user_message)
    except Exception:
        return _fallback_response(user_message)
