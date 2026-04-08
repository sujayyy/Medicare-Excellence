from flask import Blueprint, g, jsonify, request

from services.auth_service import require_role
from services.vital_service import ValidationError, create_patient_vital, get_vital_records

vitals_blueprint = Blueprint("vitals", __name__)


@vitals_blueprint.get("/vitals")
@require_role("patient", "doctor", "hospital_admin")
def vitals():
    return jsonify({"vitals": get_vital_records(g.current_user)})


@vitals_blueprint.post("/vitals")
@require_role("patient")
def create_vital():
    payload = request.get_json(silent=True) or {}
    try:
        vital = create_patient_vital(payload, g.current_user)
        return jsonify({"vital": vital}), 201
    except ValidationError as exc:
        return jsonify({"error": str(exc)}), 400
