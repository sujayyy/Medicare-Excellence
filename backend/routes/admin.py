from flask import Blueprint, g, jsonify, request

from services.admin_service import (
    acknowledge_alert,
    get_alert_records,
    get_analytics_overview,
    get_dashboard_stats,
    get_emergency_records,
    get_patient_records,
    send_care_outreach,
    update_care_coordinator_workflow,
)
from services.auth_service import require_role

admin_blueprint = Blueprint("admin", __name__)


@admin_blueprint.get("/stats")
@require_role("doctor", "hospital_admin")
def stats():
    return jsonify(get_dashboard_stats(g.current_user))


@admin_blueprint.get("/patients")
@require_role("doctor", "hospital_admin")
def patients():
    return jsonify({"patients": get_patient_records(g.current_user)})


@admin_blueprint.get("/emergencies")
@require_role("doctor", "hospital_admin")
def emergencies():
    return jsonify({"emergencies": get_emergency_records(g.current_user)})


@admin_blueprint.get("/alerts")
@require_role("doctor", "hospital_admin")
def alerts():
    return jsonify({"alerts": get_alert_records(g.current_user)})


@admin_blueprint.get("/analytics/overview")
@require_role("doctor", "hospital_admin")
def analytics_overview():
    return jsonify(get_analytics_overview(g.current_user))


@admin_blueprint.post("/alerts/<alert_id>/acknowledge")
@require_role("doctor", "hospital_admin")
def acknowledge_alert_route(alert_id: str):
    try:
        return jsonify({"alert": acknowledge_alert(g.current_user, alert_id)})
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 404
    except PermissionError as exc:
        return jsonify({"error": str(exc)}), 403


@admin_blueprint.patch("/patients/<patient_id>/care-coordination")
@require_role("doctor", "hospital_admin")
def update_care_coordination_route(patient_id: str):
    try:
        return jsonify({"patient": update_care_coordinator_workflow(g.current_user, patient_id, request.get_json(silent=True) or {})})
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except PermissionError as exc:
        return jsonify({"error": str(exc)}), 403


@admin_blueprint.post("/patients/<patient_id>/care-coordination/reminder")
@require_role("doctor", "hospital_admin")
def send_care_outreach_route(patient_id: str):
    try:
        return jsonify(send_care_outreach(g.current_user, patient_id, request.get_json(silent=True) or {}))
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except PermissionError as exc:
        return jsonify({"error": str(exc)}), 403
