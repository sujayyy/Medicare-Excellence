from collections import Counter
from datetime import datetime, timedelta, timezone
from typing import Optional

from models.base import serialize_document
from models.alert_model import get_alert_by_id, list_alerts, update_alert_status
from models.appointment_model import list_appointments
from models.document_model import list_documents
from models.emergency_model import list_emergencies
from models.patient_model import get_patient_by_id, list_patients, update_patient_profile
from models.vital_model import list_vitals
from services.appointment_risk_service import build_appointment_risk_profile
from services.care_coordinator_service import build_care_coordinator_queue
from services.care_outreach_service import create_care_outreach_attempt
from services.clinical_safety_service import build_clinical_safety_watch, enrich_patient_with_clinical_safety
from services.deterioration_prediction_service import enrich_deterioration_prediction
from services.db import get_database
from services.early_warning_service import enrich_patient_with_early_warning
from services.followup_dropout_service import enrich_patient_with_followup_dropout_risk
from services.model_intelligence_service import evaluate_model_stack
from services.outbreak_detection_service import build_outbreak_signals
from services.readmission_risk_service import enrich_patient_with_readmission_risk
from models.user_model import list_users_by_role


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

    enriched = patient
    if score in (None, 0) or not label or not reason or not priority:
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
    predicted = enrich_deterioration_prediction(enriched) or enriched
    with_safety = enrich_patient_with_clinical_safety(predicted) or predicted
    vitals = list_vitals(patient_user_id=with_safety.get("user_id"))[:3] if with_safety.get("user_id") else []
    with_early_warning = enrich_patient_with_early_warning(with_safety, vitals=vitals) or with_safety
    documents = list_documents(patient_user_id=with_early_warning.get("user_id"))[:6] if with_early_warning.get("user_id") else []
    with_readmission = enrich_patient_with_readmission_risk(with_early_warning, vitals=vitals, documents=documents) or with_early_warning
    return enrich_patient_with_followup_dropout_risk(with_readmission) or with_readmission


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
    hospital_id, assigned_doctor_id = _hospital_filter(user)
    documents = list_documents(hospital_id=hospital_id, assigned_doctor_id=assigned_doctor_id)
    appointments = list_appointments(hospital_id=hospital_id, assigned_doctor_id=assigned_doctor_id)
    doctors = list_users_by_role("doctor", hospital_id=hospital_id)
    stats = get_dashboard_stats(user)
    now = datetime.now(timezone.utc)

    symptom_counter: Counter[str] = Counter()
    red_flag_counter: Counter[str] = Counter()
    risk_counter: Counter[str] = Counter()
    deterioration_counter: Counter[str] = Counter()

    for patient in patients:
        symptom_counter.update(patient.get("symptoms") or [])
        red_flag_counter.update(patient.get("red_flags") or [])
        risk_counter.update([patient.get("risk_level") or patient.get("triage_label") or "Low"])
        deterioration_counter.update([patient.get("deterioration_prediction_label") or "Low"])

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

    prediction_watchlist = [
        {
            "id": patient.get("id"),
            "name": patient.get("name"),
            "email": patient.get("email"),
            "assigned_doctor_name": patient.get("assigned_doctor_name") or "",
            "deterioration_prediction_label": patient.get("deterioration_prediction_label") or "Low",
            "deterioration_prediction_score": patient.get("deterioration_prediction_score") or 0,
            "deterioration_prediction_reason": patient.get("deterioration_prediction_reason") or "",
            "predicted_followup_window": patient.get("predicted_followup_window") or "Routine 72-hour review",
            "prediction_next_check_at": patient.get("prediction_next_check_at"),
            "risk_trajectory": patient.get("risk_trajectory") or "stable",
            "worsening_flag": bool(patient.get("worsening_flag")),
            "triage_label": patient.get("triage_label") or patient.get("risk_level") or "Low",
            "summary_headline": patient.get("summary_headline") or "No AI summary yet.",
        }
        for patient in sorted(
            patients,
            key=lambda patient: (
                patient.get("deterioration_prediction_score") or 0,
                patient.get("triage_score") or 0,
                patient.get("appointment_risk_score") or 0,
            ),
            reverse=True,
        )[:6]
    ]

    review_queue_summary = {
        "immediate": len([patient for patient in patients if (patient.get("deterioration_prediction_label") or "Low") == "Critical"]),
        "within_6_hours": len([patient for patient in patients if (patient.get("deterioration_prediction_label") or "Low") == "High"]),
        "within_24_hours": len([patient for patient in patients if (patient.get("deterioration_prediction_label") or "Low") == "Medium"]),
        "routine": len([patient for patient in patients if (patient.get("deterioration_prediction_label") or "Low") == "Low"]),
    }

    early_warning_summary = {
        "critical": len([patient for patient in patients if (patient.get("early_warning_priority") or "Low") == "Critical"]),
        "high": len([patient for patient in patients if (patient.get("early_warning_priority") or "Low") == "High"]),
        "medium": len([patient for patient in patients if (patient.get("early_warning_priority") or "Low") == "Medium"]),
        "low": len([patient for patient in patients if (patient.get("early_warning_priority") or "Low") == "Low"]),
    }

    early_warning_watchlist = [
        {
            "id": patient.get("id"),
            "name": patient.get("name"),
            "email": patient.get("email"),
            "assigned_doctor_name": patient.get("assigned_doctor_name") or "",
            "early_warning_score": patient.get("early_warning_score") or 0,
            "early_warning_priority": patient.get("early_warning_priority") or "Low",
            "early_warning_summary": patient.get("early_warning_summary") or "",
            "early_warning_response": patient.get("early_warning_response") or "",
            "early_warning_monitoring_window": patient.get("early_warning_monitoring_window") or "",
            "updated_at": patient.get("early_warning_updated_at") or patient.get("updated_at"),
        }
        for patient in sorted(
            patients,
            key=lambda patient: (
                patient.get("early_warning_score") or 0,
                patient.get("triage_score") or 0,
                patient.get("deterioration_prediction_score") or 0,
            ),
            reverse=True,
        )[:6]
    ]

    readmission_risk_summary = {
        "critical": len([patient for patient in patients if (patient.get("readmission_risk_label") or "Low") == "Critical"]),
        "high": len([patient for patient in patients if (patient.get("readmission_risk_label") or "Low") == "High"]),
        "medium": len([patient for patient in patients if (patient.get("readmission_risk_label") or "Low") == "Medium"]),
        "low": len([patient for patient in patients if (patient.get("readmission_risk_label") or "Low") == "Low"]),
    }

    readmission_watchlist = [
        {
            "id": patient.get("id"),
            "name": patient.get("name"),
            "email": patient.get("email"),
            "assigned_doctor_name": patient.get("assigned_doctor_name") or "",
            "readmission_risk_score": patient.get("readmission_risk_score") or 0,
            "readmission_risk_label": patient.get("readmission_risk_label") or "Low",
            "readmission_risk_summary": patient.get("readmission_risk_summary") or "",
            "readmission_risk_factors": patient.get("readmission_risk_factors") or [],
            "relapse_risk_window": patient.get("relapse_risk_window") or "",
            "updated_at": patient.get("readmission_prediction_updated_at") or patient.get("updated_at"),
        }
        for patient in sorted(
            patients,
            key=lambda patient: (
                patient.get("readmission_risk_score") or 0,
                patient.get("deterioration_prediction_score") or 0,
                patient.get("early_warning_score") or 0,
            ),
            reverse=True,
        )[:6]
    ]

    followup_dropout_summary = {
        "critical": len([patient for patient in patients if (patient.get("followup_dropout_risk_label") or "Low") == "Critical"]),
        "high": len([patient for patient in patients if (patient.get("followup_dropout_risk_label") or "Low") == "High"]),
        "medium": len([patient for patient in patients if (patient.get("followup_dropout_risk_label") or "Low") == "Medium"]),
        "low": len([patient for patient in patients if (patient.get("followup_dropout_risk_label") or "Low") == "Low"]),
    }

    followup_dropout_watchlist = [
        {
            "id": patient.get("id"),
            "name": patient.get("name"),
            "email": patient.get("email"),
            "assigned_doctor_name": patient.get("assigned_doctor_name") or "",
            "followup_dropout_risk_score": patient.get("followup_dropout_risk_score") or 0,
            "followup_dropout_risk_label": patient.get("followup_dropout_risk_label") or "Low",
            "followup_dropout_risk_summary": patient.get("followup_dropout_risk_summary") or "",
            "followup_dropout_risk_factors": patient.get("followup_dropout_risk_factors") or [],
            "followup_outreach_window": patient.get("followup_outreach_window") or "",
            "updated_at": patient.get("followup_dropout_updated_at") or patient.get("updated_at"),
        }
        for patient in sorted(
            patients,
            key=lambda patient: (
                patient.get("followup_dropout_risk_score") or 0,
                patient.get("appointment_risk_score") or 0,
                patient.get("missed_followup_count") or 0,
            ),
            reverse=True,
        )[:6]
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

    outbreak_signals = build_outbreak_signals(patients=patients, emergencies=emergencies, now=now)
    safety_watch = build_clinical_safety_watch(patients, appointments=appointments)
    coordinator_queue = build_care_coordinator_queue(patients)
    model_metrics = evaluate_model_stack()
    specialty_counter: Counter[str] = Counter()
    for appointment in appointments:
        specialty_counter.update(
            [
                appointment.get("requested_specialty")
                or appointment.get("assigned_doctor_specialty")
                or "general_medicine"
            ]
        )

    upcoming_appointments = [
        appointment
        for appointment in appointments
        if appointment.get("status") not in {"cancelled", "completed"}
    ]
    today_iso = now.date().isoformat()
    doctor_workload = []
    total_configured_slots = 0
    total_booked_slots = 0
    for doctor in doctors:
        doctor_id = str(doctor.get("_id"))
        doctor_appointments = [appointment for appointment in appointments if appointment.get("assigned_doctor_id") == doctor_id]
        configured_slots = doctor.get("booking_slots") or []
        total_configured_slots += len(configured_slots)
        total_booked_slots += len(
            [
                appointment
                for appointment in doctor_appointments
                if appointment.get("status") not in {"cancelled", "completed"}
            ]
        )
        doctor_workload.append(
            {
                "doctor_id": doctor_id,
                "doctor_name": doctor.get("name", ""),
                "doctor_code": doctor.get("doctor_code"),
                "specialty": doctor.get("specialty"),
                "booked_appointments": len(doctor_appointments),
                "open_requests": len([appointment for appointment in doctor_appointments if appointment.get("status") == "requested"]),
                "in_consultation": len([appointment for appointment in doctor_appointments if appointment.get("status") == "in_consultation"]),
                "completed_today": len(
                    [
                        appointment
                        for appointment in doctor_appointments
                        if appointment.get("status") == "completed"
                        and str(appointment.get("completed_at") or "").startswith(today_iso)
                    ]
                ),
                "upcoming_slots": len(configured_slots),
                "avg_triage_score": round(
                    sum((appointment.get("doctor_copilot", {}) or {}).get("early_warning", {}).get("early_warning_score", 0) for appointment in doctor_appointments)
                    / max(len(doctor_appointments), 1),
                    1,
                ) if doctor_appointments else 0,
            }
        )

    specialty_demand = [
        {"specialty": specialty, "count": count}
        for specialty, count in specialty_counter.most_common(8)
    ]
    executive_summary = {
        "total_doctors": len(doctors),
        "scheduled_consultations": len(upcoming_appointments),
        "completed_today": len(
            [appointment for appointment in appointments if appointment.get("status") == "completed" and str(appointment.get("completed_at") or "").startswith(today_iso)]
        ),
        "slot_utilization": round((total_booked_slots / total_configured_slots) * 100, 1) if total_configured_slots else 0,
        "available_capacity": max(total_configured_slots - total_booked_slots, 0),
    }
    document_intelligence_summary = {
        "total_documents": len(documents),
        "prescriptions": len([document for document in documents if document.get("document_type") == "prescription"]),
        "lab_reports": len([document for document in documents if document.get("document_type") == "lab_report"]),
        "discharge_notes": len([document for document in documents if document.get("document_type") == "discharge_note"]),
        "flagged_documents": len(
            [
                document
                for document in documents
                if (document.get("abnormal_findings") or [])
                or document.get("review_priority") in {"Urgent", "Priority"}
            ]
        ),
    }
    for cluster in outbreak_signals.get("outbreak_clusters", [])[:3]:
        anomaly_signals.append(
            {
                "signal": f"{cluster['cluster'].lower()} cluster",
                "recent_count": cluster["recent_count"],
                "baseline_count": cluster["baseline_daily_avg"],
                "severity": cluster["severity"],
                "summary": cluster["summary"],
            }
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
        "deterioration_distribution": [
            {"name": risk, "count": count}
            for risk, count in deterioration_counter.items()
        ],
        "care_funnel": [
            {"stage": "Chats", "value": stats["activeChats"]},
            {"stage": "Patients", "value": stats["totalPatients"]},
            {"stage": "Appointments", "value": stats["appointmentRequests"]},
            {"stage": "Emergencies", "value": stats["openEmergencies"]},
            {"stage": "Alerts", "value": stats["openAlerts"]},
        ],
        "priority_patients": summary_signals,
        "prediction_watchlist": prediction_watchlist,
        "review_queue_summary": review_queue_summary,
        "clinical_safety_summary": safety_watch["clinical_safety_summary"],
        "clinical_safety_watch": safety_watch["clinical_safety_watch"],
        "early_warning_summary": early_warning_summary,
        "early_warning_watchlist": early_warning_watchlist,
        "readmission_risk_summary": readmission_risk_summary,
        "readmission_watchlist": readmission_watchlist,
        "followup_dropout_summary": followup_dropout_summary,
        "followup_dropout_watchlist": followup_dropout_watchlist,
        "care_coordinator_summary": coordinator_queue["care_coordinator_summary"],
        "care_coordinator_queue": coordinator_queue["care_coordinator_queue"],
        "executive_summary": executive_summary,
        "doctor_workload": sorted(doctor_workload, key=lambda entry: (entry["open_requests"], entry["booked_appointments"]), reverse=True),
        "specialty_demand": specialty_demand,
        "model_metrics": model_metrics,
        "document_intelligence_summary": document_intelligence_summary,
        "demand_forecast": {
            "projected_patient_load": projected_patient_load,
            "projected_emergency_load": projected_emergency_load,
            "staffing_pressure": staffing_pressure,
            "forecast_window": "Next 7 days",
        },
        "outbreak_clusters": outbreak_signals.get("outbreak_clusters", []),
        "outbreak_timeline": outbreak_signals.get("outbreak_timeline", []),
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
            "readmission_high_risk_patients": len(
                [
                    patient
                    for patient in patients
                    if (patient.get("readmission_risk_label") or "Low") in {"High", "Critical"}
                ]
            ),
            "followup_dropout_high_risk_patients": len(
                [
                    patient
                    for patient in patients
                    if (patient.get("followup_dropout_risk_label") or "Low") in {"High", "Critical"}
                ]
            ),
            "care_coordinator_urgent_tasks": len(
                [
                    item
                    for item in coordinator_queue["care_coordinator_queue"]
                    if item.get("priority") in {"Critical", "High"}
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


def update_care_coordinator_workflow(user: dict, patient_id: str, payload: dict) -> dict:
    patient = get_patient_by_id(patient_id)
    if not patient:
        raise ValueError("Patient not found.")

    if patient.get("hospital_id") != user.get("hospital_id"):
        raise PermissionError("You do not have access to this patient.")

    if user.get("role") == "doctor" and patient.get("assigned_doctor_id") not in {str(user["_id"]), None, ""}:
        raise PermissionError("This patient is outside your assigned care queue.")

    status = str(payload.get("status") or "").strip().lower()
    note = " ".join(str(payload.get("note") or "").split()).strip()
    allowed_statuses = {"open", "contacted", "no_response", "rescheduled", "monitoring", "escalated", "resolved"}
    if status not in allowed_statuses:
        raise ValueError("Unsupported care coordinator status.")
    if status != "open" and len(note) < 6:
        raise ValueError("Please add a short note before updating the coordinator workflow.")

    now = datetime.now(timezone.utc)
    history = list(patient.get("care_coordinator_history") or [])
    history.insert(
        0,
        {
            "status": status,
            "note": note,
            "actor_name": user.get("name") or "Care team",
            "actor_role": user.get("role") or "",
            "actor_user_id": str(user.get("_id") or ""),
            "created_at": now,
        },
    )

    user_id = patient.get("user_id")
    if not user_id:
        raise ValueError("Patient workflow cannot be updated because no linked user is present.")

    update_patient_profile(
        user_id,
        {
            "care_coordinator_status": status,
            "care_coordinator_note": note,
            "care_coordinator_updated_at": now,
            "care_coordinator_updated_by": user.get("name") or "Care team",
            "care_coordinator_updated_by_user_id": str(user.get("_id") or ""),
            "care_coordinator_history": history[:12],
        },
    )

    refreshed = get_patient_by_id(patient_id)
    refreshed_patient = serialize_document(refreshed) or refreshed
    enriched = _enrich_patient_record(refreshed_patient) if refreshed_patient else None
    if not enriched:
        raise ValueError("Unable to refresh patient workflow state.")
    return enriched


def send_care_outreach(user: dict, patient_id: str, payload: dict) -> dict:
    patient = get_patient_by_id(patient_id)
    if not patient:
        raise ValueError("Patient not found.")

    if patient.get("hospital_id") != user.get("hospital_id"):
        raise PermissionError("You do not have access to this patient.")

    if user.get("role") == "doctor" and patient.get("assigned_doctor_id") not in {str(user["_id"]), None, ""}:
        raise PermissionError("This patient is outside your assigned care queue.")

    attempt = create_care_outreach_attempt(patient, channel=payload.get("channel"), actor=user)
    outreach_history = list(patient.get("care_outreach_history") or [])
    outreach_history.insert(0, attempt)

    user_id = patient.get("user_id")
    if not user_id:
        raise ValueError("Patient outreach cannot be logged because no linked user is present.")

    update_fields = {
        "care_outreach_history": outreach_history[:12],
    }

    current_status = (patient.get("care_coordinator_status") or "open").lower()
    if current_status == "open":
        update_fields.update(
            {
                "care_coordinator_status": "contacted" if attempt.get("channel") != "phone" else "monitoring",
                "care_coordinator_note": payload.get("note") or f"Outreach sent by {attempt.get('channel')}.",
                "care_coordinator_updated_at": attempt.get("created_at"),
                "care_coordinator_updated_by": user.get("name") or "Care team",
                "care_coordinator_updated_by_user_id": str(user.get("_id") or ""),
            }
        )

    update_patient_profile(user_id, update_fields)

    refreshed = get_patient_by_id(patient_id)
    refreshed_patient = serialize_document(refreshed) or refreshed
    enriched = _enrich_patient_record(refreshed_patient) if refreshed_patient else None
    if not enriched:
        raise ValueError("Unable to refresh patient after outreach.")
    return {"patient": enriched, "attempt": attempt}
