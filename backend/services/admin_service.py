from collections import Counter
from datetime import datetime, timedelta, timezone
from typing import Optional

from models.base import serialize_document
from models.alert_model import get_alert_by_id, list_alerts, update_alert_status
from models.emergency_model import list_emergencies
from models.patient_model import list_patients
from services.appointment_risk_service import build_appointment_risk_profile
from services.deterioration_prediction_service import enrich_deterioration_prediction
from services.db import get_database


def _parse_datetime(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


def _count_since(records: list[dict], *, field_names: list[str], since: datetime) -> int:
    total = 0
    for record in records:
        timestamp = None
        for field_name in field_names:
            timestamp = _parse_datetime(record.get(field_name))
            if timestamp:
                break
        if timestamp and timestamp >= since:
            total += 1
    return total


def _hospital_filter(user: dict) -> tuple[Optional[str], Optional[str]]:
    role = user.get("role")
    hospital_id = user.get("hospital_id")
    if role == "doctor":
        return hospital_id, str(user["_id"])
    return hospital_id, None


def get_dashboard_stats(user: dict) -> dict:
    db = get_database()
    hospital_id, assigned_doctor_id = _hospital_filter(user)

    user_query = {"hospital_id": hospital_id} if hospital_id else {}
    patient_query = {"hospital_id": hospital_id} if hospital_id else {}
    emergency_query = {"hospital_id": hospital_id} if hospital_id else {}
    chat_query = {"hospital_id": hospital_id} if hospital_id else {}
    alert_query = {"hospital_id": hospital_id} if hospital_id else {}

    if assigned_doctor_id:
        patient_query["assigned_doctor_id"] = assigned_doctor_id
        emergency_query["assigned_doctor_id"] = assigned_doctor_id
        alert_query["target_user_id"] = assigned_doctor_id
    else:
        alert_query["target_role"] = "hospital_admin"

    total_users = db["users"].count_documents(user_query)
    total_patients = db["patients"].count_documents(patient_query)
    scoped_emergencies = list_emergencies(hospital_id=hospital_id, assigned_doctor_id=assigned_doctor_id)
    total_emergencies = len(scoped_emergencies)
    open_emergencies = len([entry for entry in scoped_emergencies if entry.get("status") == "open"])
    total_chats = db["chats"].count_documents(chat_query if not assigned_doctor_id else {"hospital_id": hospital_id})
    scoped_alerts = list_alerts(
        hospital_id=hospital_id,
        target_user_id=assigned_doctor_id if assigned_doctor_id else None,
        target_role=None if assigned_doctor_id else "hospital_admin",
    )
    open_alerts = len([entry for entry in scoped_alerts if entry.get("status") == "open"])

    appointment_requests = db["patients"].aggregate(
        [{"$match": patient_query}, {"$group": {"_id": None, "count": {"$sum": "$appointments_requested"}}}]
    )
    appointment_count = next(appointment_requests, {"count": 0})["count"]

    return {
        "totalUsers": total_users,
        "totalPatients": total_patients,
        "totalEmergencies": total_emergencies,
        "openEmergencies": open_emergencies,
        "activeChats": total_chats,
        "appointmentRequests": appointment_count,
        "openAlerts": open_alerts,
    }


def _enrich_patient_record(patient: dict) -> dict:
    score = patient.get("appointment_risk_score")
    label = patient.get("appointment_risk_label")
    reason = patient.get("appointment_risk_reason")
    priority = patient.get("followup_priority")

    if score not in (None, 0) and label and reason and priority:
        return patient

    derived = build_appointment_risk_profile(
        previous_patient=patient,
        triage={
            "triage_score": patient.get("triage_score") or 0,
            "triage_label": patient.get("triage_label") or patient.get("risk_level") or "Low",
        },
        entities={
            "symptoms": patient.get("symptoms") or [],
            "red_flags": patient.get("red_flags") or [],
        },
        current_status=patient.get("status") or "Monitoring",
        deterioration={
            "worsening_flag": patient.get("worsening_flag"),
            "risk_trajectory": patient.get("risk_trajectory"),
            "repeat_symptom_count": patient.get("repeat_symptom_count"),
        },
    )
    enriched = serialize_document({**patient, **derived}) or patient
    return enrich_deterioration_prediction(enriched) or enriched


def get_patient_records(user: dict) -> list[dict]:
    hospital_id, assigned_doctor_id = _hospital_filter(user)
    patients = list_patients(hospital_id=hospital_id, assigned_doctor_id=assigned_doctor_id)
    return [_enrich_patient_record(patient) for patient in patients]


def get_emergency_records(user: dict) -> list[dict]:
    hospital_id, assigned_doctor_id = _hospital_filter(user)
    return list_emergencies(hospital_id=hospital_id, assigned_doctor_id=assigned_doctor_id)


def get_alert_records(user: dict) -> list[dict]:
    if user.get("role") == "doctor":
        return list_alerts(hospital_id=user.get("hospital_id"), target_user_id=str(user["_id"]), status="open")
    return list_alerts(hospital_id=user.get("hospital_id"), target_role="hospital_admin", status="open")


def get_analytics_overview(user: dict) -> dict:
    patients = get_patient_records(user)
    emergencies = get_emergency_records(user)
    alerts = get_alert_records(user)
    stats = get_dashboard_stats(user)
    now = datetime.now(timezone.utc)

    symptom_counter: Counter[str] = Counter()
    red_flag_counter: Counter[str] = Counter()
    risk_counter: Counter[str] = Counter()

    for patient in patients:
        symptom_counter.update(patient.get("symptoms") or [])
        red_flag_counter.update(patient.get("red_flags") or [])
        risk_counter.update([patient.get("risk_level") or patient.get("triage_label") or "Low"])

    priority_patients = sorted(
        patients,
        key=lambda patient: (
            patient.get("triage_score") or 0,
            patient.get("emergency_count") or 0,
            patient.get("appointments_requested") or 0,
        ),
        reverse=True,
    )[:5]

    summary_signals = [
        {
            "id": patient.get("id"),
            "name": patient.get("name"),
            "email": patient.get("email"),
            "summary_headline": patient.get("summary_headline") or "No AI summary yet.",
            "clinical_summary": patient.get("clinical_summary") or patient.get("soap_summary") or patient.get("last_summary") or "",
            "escalation_note": patient.get("escalation_note") or patient.get("recommended_action") or "",
            "risk_level": patient.get("risk_level") or "Low",
            "assigned_doctor_name": patient.get("assigned_doctor_name") or "",
            "deterioration_prediction_label": patient.get("deterioration_prediction_label") or "Low",
            "deterioration_prediction_score": patient.get("deterioration_prediction_score") or 0,
            "predicted_followup_window": patient.get("predicted_followup_window") or "Routine 72-hour review",
            "updated_at": patient.get("updated_at"),
        }
        for patient in priority_patients
    ]

    last_7_days_patients = _count_since(patients, field_names=["updated_at", "created_at"], since=now - timedelta(days=7))
    previous_7_days_patients = _count_since(
        patients,
        field_names=["updated_at", "created_at"],
        since=now - timedelta(days=14),
    ) - last_7_days_patients
    last_7_days_emergencies = _count_since(emergencies, field_names=["created_at", "updated_at"], since=now - timedelta(days=7))
    previous_7_days_emergencies = _count_since(
        emergencies,
        field_names=["created_at", "updated_at"],
        since=now - timedelta(days=14),
    ) - last_7_days_emergencies

    projected_patient_load = max(last_7_days_patients, round((last_7_days_patients * 0.65) + (max(previous_7_days_patients, 0) * 0.35)))
    projected_emergency_load = max(last_7_days_emergencies, round((last_7_days_emergencies * 0.7) + (max(previous_7_days_emergencies, 0) * 0.3)))
    staffing_pressure = "Stable"
    if projected_emergency_load >= 5 or stats["openEmergencies"] >= 3:
        staffing_pressure = "High"
    elif projected_emergency_load >= 2 or stats["openAlerts"] >= 3:
        staffing_pressure = "Elevated"

    recent_48h_counter: Counter[str] = Counter()
    baseline_counter: Counter[str] = Counter()
    recent_threshold = now - timedelta(hours=48)
    baseline_threshold = now - timedelta(days=14)
    for patient in patients:
        updated_at = _parse_datetime(patient.get("updated_at") or patient.get("created_at"))
        if not updated_at:
            continue
        symptoms = patient.get("symptoms") or []
        if updated_at >= recent_threshold:
            recent_48h_counter.update(symptoms)
        elif updated_at >= baseline_threshold:
            baseline_counter.update(symptoms)

    anomaly_signals = []
    for symptom, recent_count in recent_48h_counter.most_common(5):
        baseline_count = baseline_counter.get(symptom, 0)
        if recent_count >= 2 and (baseline_count == 0 or recent_count >= baseline_count + 2):
            anomaly_signals.append(
                {
                    "signal": symptom,
                    "recent_count": recent_count,
                    "baseline_count": baseline_count,
                    "severity": "high" if recent_count >= baseline_count + 3 or recent_count >= 4 else "medium",
                    "summary": f"{symptom.title()} mentions are trending above the recent baseline.",
                }
            )

    recent_24h_emergencies = _count_since(emergencies, field_names=["created_at", "updated_at"], since=now - timedelta(hours=24))
    prior_6_day_emergencies = _count_since(emergencies, field_names=["created_at", "updated_at"], since=now - timedelta(days=7)) - recent_24h_emergencies
    average_daily_prior_emergencies = round(max(prior_6_day_emergencies, 0) / 6, 1) if prior_6_day_emergencies > 0 else 0
    if recent_24h_emergencies >= 2 and recent_24h_emergencies > max(1, average_daily_prior_emergencies * 2):
        anomaly_signals.insert(
            0,
            {
                "signal": "emergency surge",
                "recent_count": recent_24h_emergencies,
                "baseline_count": average_daily_prior_emergencies,
                "severity": "high",
                "summary": "Emergency cases in the last 24 hours are materially above the recent daily average.",
            },
        )

    return {
        "symptom_distribution": [
            {"name": symptom, "count": count}
            for symptom, count in symptom_counter.most_common(6)
        ],
        "red_flag_distribution": [
            {"name": symptom, "count": count}
            for symptom, count in red_flag_counter.most_common(6)
        ],
        "risk_distribution": [
            {"name": risk, "count": count}
            for risk, count in risk_counter.items()
        ],
        "care_funnel": [
            {"stage": "Chats", "value": stats["activeChats"]},
            {"stage": "Patients", "value": stats["totalPatients"]},
            {"stage": "Appointments", "value": stats["appointmentRequests"]},
            {"stage": "Emergencies", "value": stats["openEmergencies"]},
            {"stage": "Alerts", "value": stats["openAlerts"]},
        ],
        "priority_patients": summary_signals,
        "demand_forecast": {
            "projected_patient_load": projected_patient_load,
            "projected_emergency_load": projected_emergency_load,
            "staffing_pressure": staffing_pressure,
            "forecast_window": "Next 7 days",
        },
        "anomaly_signals": anomaly_signals[:5],
        "operational_flags": {
            "high_risk_patients": len(
                [
                    patient
                    for patient in patients
                    if (patient.get("risk_level") or patient.get("triage_label")) in {"High", "Critical"}
                ]
            ),
            "predicted_high_risk_patients": len(
                [
                    patient
                    for patient in patients
                    if (patient.get("deterioration_prediction_label") or "Low") in {"High", "Critical"}
                ]
            ),
            "open_alerts": len(alerts),
            "open_emergencies": len([entry for entry in emergencies if entry.get("status") == "open"]),
        },
    }


def acknowledge_alert(user: dict, alert_id: str) -> dict:
    alert = get_alert_by_id(alert_id)
    if not alert:
        raise ValueError("Alert not found.")

    if alert.get("hospital_id") != user.get("hospital_id"):
        raise PermissionError("You do not have access to this alert.")

    if user.get("role") == "doctor" and alert.get("target_user_id") != str(user["_id"]):
        raise PermissionError("You do not have access to this alert.")

    if user.get("role") == "hospital_admin" and alert.get("target_role") != "hospital_admin":
        raise PermissionError("You do not have access to this alert.")

    updated = update_alert_status(
        alert_id,
        status="resolved",
        acknowledged_by_user_id=str(user["_id"]),
        acknowledged_by_name=user.get("name"),
    )
    if not updated:
        raise ValueError("Unable to update alert.")
    return serialize_document(updated)
