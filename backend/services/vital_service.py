from typing import Any

from models.alert_model import create_alert
from models.patient_model import get_patient_by_user_id, update_patient_profile
from models.user_model import DEFAULT_HOSPITAL_ID
from models.vital_model import create_vital_record, list_vitals


class ValidationError(ValueError):
    pass


def _to_float(value: Any, field_name: str) -> float:
    try:
        return float(value)
    except (TypeError, ValueError) as exc:
        raise ValidationError(f"{field_name} must be a valid number.") from exc


def _analyze_vitals(
    *,
    pulse: float,
    spo2: float,
    temperature: float,
    systolic_bp: float,
    diastolic_bp: float,
    glucose: float,
) -> dict[str, Any]:
    flags: list[str] = []
    severity = "normal"

    if spo2 < 90:
        flags.append("Critically low oxygen saturation")
        severity = "critical"
    elif spo2 < 94:
        flags.append("Low oxygen saturation")
        severity = "high"

    if pulse > 125 or pulse < 45:
        flags.append("Abnormal pulse rate")
        severity = "critical" if severity != "critical" else severity
    elif pulse > 105 or pulse < 55:
        flags.append("Pulse outside the typical resting range")
        if severity == "normal":
            severity = "medium"

    if temperature >= 103 or temperature <= 95:
        flags.append("Temperature suggests urgent review")
        severity = "high" if severity not in {"critical", "high"} else severity
    elif temperature >= 100.4:
        flags.append("Fever detected")
        if severity == "normal":
            severity = "medium"

    if systolic_bp >= 180 or diastolic_bp >= 120:
        flags.append("Blood pressure is in crisis range")
        severity = "critical"
    elif systolic_bp >= 140 or diastolic_bp >= 90:
        flags.append("High blood pressure reading")
        if severity == "normal":
            severity = "medium"

    if glucose >= 250 or glucose <= 60:
        flags.append("Glucose reading is outside a safe range")
        severity = "high" if severity != "critical" else severity
    elif glucose >= 180:
        flags.append("Glucose is above the normal target range")
        if severity == "normal":
            severity = "medium"

    summary = "Vitals are within the expected range."
    if flags:
        summary = "; ".join(flags[:3]) + "."

    return {
        "severity": severity,
        "anomaly_flags": flags,
        "summary": summary,
    }


def create_patient_vital(payload: dict[str, Any], user: dict[str, Any]) -> dict[str, Any]:
    if user.get("role") != "patient":
        raise ValidationError("Only patients can submit vitals.")

    pulse = _to_float(payload.get("pulse"), "Pulse")
    spo2 = _to_float(payload.get("spo2"), "SpO2")
    temperature = _to_float(payload.get("temperature"), "Temperature")
    systolic_bp = _to_float(payload.get("systolic_bp"), "Systolic BP")
    diastolic_bp = _to_float(payload.get("diastolic_bp"), "Diastolic BP")
    glucose = _to_float(payload.get("glucose"), "Glucose")
    notes = (payload.get("notes") or "").strip()

    patient_profile = get_patient_by_user_id(str(user["_id"])) or {}
    hospital_id = user.get("hospital_id") or patient_profile.get("hospital_id") or DEFAULT_HOSPITAL_ID
    assigned_doctor_id = patient_profile.get("assigned_doctor_id")
    assigned_doctor_name = patient_profile.get("assigned_doctor_name", "")
    analysis = _analyze_vitals(
        pulse=pulse,
        spo2=spo2,
        temperature=temperature,
        systolic_bp=systolic_bp,
        diastolic_bp=diastolic_bp,
        glucose=glucose,
    )

    vital = create_vital_record(
        {
            "patient_user_id": str(user["_id"]),
            "patient_name": user.get("name"),
            "patient_email": user.get("email"),
            "hospital_id": hospital_id,
            "assigned_doctor_id": assigned_doctor_id,
            "assigned_doctor_name": assigned_doctor_name,
            "pulse": pulse,
            "spo2": spo2,
            "temperature": temperature,
            "systolic_bp": systolic_bp,
            "diastolic_bp": diastolic_bp,
            "glucose": glucose,
            "notes": notes,
            "severity": analysis["severity"],
            "anomaly_flags": analysis["anomaly_flags"],
            "summary": analysis["summary"],
        }
    )

    update_patient_profile(
        str(user["_id"]),
        {
            "latest_vital_summary": analysis["summary"],
            "latest_vital_severity": analysis["severity"],
            "latest_vital_updated_at": vital.get("created_at"),
        },
    )

    if analysis["severity"] in {"high", "critical"}:
        payload_base = {
            "type": "abnormal_vitals",
            "title": "Abnormal vitals submitted",
            "message": f"{user.get('name')} submitted vitals that need review.",
            "hospital_id": hospital_id,
            "severity": "high" if analysis["severity"] == "critical" else analysis["severity"],
            "patient_user_id": str(user["_id"]),
            "patient_name": user.get("name"),
            "patient_email": user.get("email"),
            "assigned_doctor_id": assigned_doctor_id,
            "assigned_doctor_name": assigned_doctor_name,
            "source": "vitals",
            "recommended_action": analysis["summary"],
        }
        create_alert({**payload_base, "target_role": "hospital_admin"})
        if assigned_doctor_id:
            create_alert({**payload_base, "target_role": "doctor", "target_user_id": assigned_doctor_id})

    return vital


def get_vital_records(user: dict[str, Any]) -> list[dict]:
    role = user.get("role")
    if role == "patient":
        return list_vitals(patient_user_id=str(user["_id"]))
    if role == "doctor":
        return list_vitals(hospital_id=user.get("hospital_id"), assigned_doctor_id=str(user["_id"]))
    return list_vitals(hospital_id=user.get("hospital_id"))
