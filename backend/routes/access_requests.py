from flask import Blueprint, g, jsonify

from services.access_request_service import (
    ValidationError,
    approve_doctor_access_request,
    get_doctor_access_requests,
    reject_doctor_access_request,
)
from services.auth_service import require_role

access_requests_blueprint = Blueprint("access_requests", __name__)


@access_requests_blueprint.get("/access-requests")
@require_role("hospital_admin")
def access_requests():
    try:
        return jsonify({"requests": get_doctor_access_requests(g.current_user)})
    except ValidationError as exc:
        return jsonify({"error": str(exc)}), 400


@access_requests_blueprint.post("/access-requests/<request_id>/approve")
@require_role("hospital_admin")
def approve_access_request(request_id: str):
    try:
        return jsonify({"request": approve_doctor_access_request(request_id, g.current_user)})
    except ValidationError as exc:
        return jsonify({"error": str(exc)}), 400


@access_requests_blueprint.post("/access-requests/<request_id>/reject")
@require_role("hospital_admin")
def reject_access_request(request_id: str):
    try:
        return jsonify({"request": reject_doctor_access_request(request_id, g.current_user)})
    except ValidationError as exc:
        return jsonify({"error": str(exc)}), 400
