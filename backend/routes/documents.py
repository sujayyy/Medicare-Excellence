import os

from flask import Blueprint, current_app, g, jsonify, request, send_file
from flask import Response

from services.auth_service import require_role
from services.document_service import (
    ValidationError,
    create_clinician_document,
    create_patient_document,
    get_document_binary_for_user,
    get_document_record_for_user,
    get_document_records,
)

documents_blueprint = Blueprint("documents", __name__)


@documents_blueprint.get("/documents")
@require_role("patient", "doctor", "hospital_admin")
def documents():
    return jsonify({"documents": get_document_records(g.current_user)})


@documents_blueprint.post("/documents")
@require_role("patient", "doctor", "hospital_admin")
def create_document():
    payload = request.get_json(silent=True) or {}
    try:
        if g.current_user.get("role") == "patient":
            document = create_patient_document(payload, g.current_user)
        else:
            document = create_clinician_document(payload, g.current_user)
        return jsonify({"document": document}), 201
    except ValidationError as exc:
        return jsonify({"error": str(exc)}), 400


@documents_blueprint.get("/documents/<document_id>/download")
@require_role("patient", "doctor", "hospital_admin")
def download_document(document_id: str):
    try:
        document = get_document_record_for_user(document_id, g.current_user)
        if document.get("storage_gridfs_file_id"):
            _, download_stream = get_document_binary_for_user(document_id, g.current_user)
            return Response(
                download_stream.read(),
                mimetype=document.get("content_type") or "application/octet-stream",
                headers={
                    "Content-Disposition": f"attachment; filename={document.get('file_name') or 'document'}",
                },
            )

        storage_key = document.get("storage_key")
        if not storage_key:
            return jsonify({"error": "This document does not have an uploaded file."}), 404

        uploads_dir = current_app.config.get("UPLOADS_DIR") or os.path.join(current_app.root_path, "uploads", "documents")
        absolute_path = os.path.join(uploads_dir, storage_key)
        if not os.path.exists(absolute_path):
            return jsonify({"error": "Stored file not found."}), 404

        return send_file(absolute_path, as_attachment=True, download_name=document.get("file_name") or "document")
    except ValidationError as exc:
        return jsonify({"error": str(exc)}), 400
