from flask import Blueprint, g, jsonify, request

from services.auth_service import require_role
from services.document_service import ValidationError, create_patient_document, get_document_records

documents_blueprint = Blueprint("documents", __name__)


@documents_blueprint.get("/documents")
@require_role("patient", "doctor", "hospital_admin")
def documents():
    return jsonify({"documents": get_document_records(g.current_user)})


@documents_blueprint.post("/documents")
@require_role("patient")
def create_document():
    payload = request.get_json(silent=True) or {}
    try:
        document = create_patient_document(payload, g.current_user)
        return jsonify({"document": document}), 201
    except ValidationError as exc:
        return jsonify({"error": str(exc)}), 400
