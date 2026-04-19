from flask import Blueprint, g, jsonify, request

from services.appointment_service import (
    ValidationError,
    create_patient_appointment,
    get_appointment_records,
    list_doctor_directory,
    update_clinician_appointment,
)
from services.auth_service import require_auth, require_role


appointments_blueprint = Blueprint("appointments", __name__)


@appointments_blueprint.get("/doctors")
@require_auth
def doctors():
    specialty = request.args.get("specialty")
    return jsonify({"doctors": list_doctor_directory(g.current_user, specialty=specialty)})


@appointments_blueprint.get("/appointments")
@require_auth
def appointments():
    return jsonify({"appointments": get_appointment_records(g.current_user)})


@appointments_blueprint.post("/appointments")
@require_role("patient")
def create_appointment():
    try:
        return jsonify({"appointment": create_patient_appointment(request.get_json(silent=True) or {}, g.current_user)}), 201
    except ValidationError as exc:
        return jsonify({"error": str(exc)}), 400


@appointments_blueprint.patch("/appointments/<appointment_id>")
@require_role("doctor", "hospital_admin")
def update_appointment(appointment_id: str):
    try:
        return jsonify({"appointment": update_clinician_appointment(appointment_id, request.get_json(silent=True) or {}, g.current_user)})
    except ValidationError as exc:
        return jsonify({"error": str(exc)}), 400
