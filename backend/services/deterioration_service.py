from typing import Any, Optional


def build_deterioration_insights(
    *,
    previous_patient: Optional[dict[str, Any]],
    triage: dict[str, Any],
    entities: dict[str, Any],
) -> dict[str, Any]:
    previous_patient = previous_patient or {}
    previous_score = int(previous_patient.get("triage_score") or 0)
    current_score = int(triage.get("triage_score") or 0)

    previous_symptoms = set(previous_patient.get("symptoms") or [])
    current_symptoms = set(entities.get("symptoms") or [])
    repeated_symptoms = sorted(previous_symptoms & current_symptoms)

    previous_repeat_count = int(previous_patient.get("repeat_symptom_count") or 0)
    repeat_symptom_count = previous_repeat_count + 1 if repeated_symptoms else (1 if current_symptoms else 0)

    score_delta = current_score - previous_score
    if triage.get("triage_label") == "Critical":
        risk_trajectory = "critical"
    elif score_delta >= 15:
        risk_trajectory = "rising"
    elif score_delta <= -15:
        risk_trajectory = "improving"
    else:
        risk_trajectory = "stable"

    worsening_flag = bool(
        triage.get("triage_label") in {"High", "Critical"}
        and (score_delta >= 10 or bool(repeated_symptoms) or previous_patient.get("worsening_flag"))
    )

    return {
        "risk_trajectory": risk_trajectory,
        "worsening_flag": worsening_flag,
        "repeat_symptom_count": repeat_symptom_count,
        "repeated_symptoms": repeated_symptoms,
    }
