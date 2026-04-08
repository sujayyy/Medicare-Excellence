from flask import Blueprint, jsonify, request

from services.auth_service import (
    AuthenticationError,
    ValidationError,
    get_current_user_response,
    login_user,
    register_user,
    require_auth,
)

auth_blueprint = Blueprint("auth", __name__)


@auth_blueprint.post("/signup")
def signup():
    payload = request.get_json(silent=True) or {}
    try:
        return jsonify(register_user(payload)), 201
    except ValidationError as exc:
        return jsonify({"error": str(exc)}), 400
    except AuthenticationError as exc:
        return jsonify({"error": str(exc)}), 409
    except Exception as exc:  # pragma: no cover - defensive API fallback
        return jsonify({"error": f"Unable to create account: {exc}"}), 500


@auth_blueprint.post("/login")
def login():
    payload = request.get_json(silent=True) or {}
    try:
        return jsonify(login_user(payload))
    except ValidationError as exc:
        return jsonify({"error": str(exc)}), 400
    except AuthenticationError as exc:
        return jsonify({"error": str(exc)}), 401
    except Exception as exc:  # pragma: no cover - defensive API fallback
        return jsonify({"error": f"Unable to log in: {exc}"}), 500


@auth_blueprint.get("/me")
@require_auth
def me():
    return jsonify(get_current_user_response())
