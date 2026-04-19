from flask import Blueprint, jsonify, request

from services.auth_service import (
    AuthenticationError,
    ValidationError,
    get_current_user_response,
    login_user,
    request_password_reset,
    register_user,
    resend_verification_email,
    reset_password,
    require_auth,
    verify_email_token,
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


@auth_blueprint.post("/verify-email")
def verify_email():
    payload = request.get_json(silent=True) or {}
    try:
        return jsonify(verify_email_token(payload))
    except ValidationError as exc:
        return jsonify({"error": str(exc)}), 400
    except AuthenticationError as exc:
        return jsonify({"error": str(exc)}), 401
    except Exception as exc:  # pragma: no cover
        return jsonify({"error": f"Unable to verify email: {exc}"}), 500


@auth_blueprint.post("/resend-verification")
def resend_verification():
    payload = request.get_json(silent=True) or {}
    try:
        return jsonify(resend_verification_email(payload))
    except ValidationError as exc:
        return jsonify({"error": str(exc)}), 400
    except Exception as exc:  # pragma: no cover
        return jsonify({"error": f"Unable to resend verification email: {exc}"}), 500


@auth_blueprint.post("/forgot-password")
def forgot_password():
    payload = request.get_json(silent=True) or {}
    try:
        return jsonify(request_password_reset(payload))
    except ValidationError as exc:
        return jsonify({"error": str(exc)}), 400
    except Exception as exc:  # pragma: no cover
        return jsonify({"error": f"Unable to start password reset: {exc}"}), 500


@auth_blueprint.post("/reset-password")
def reset_password_route():
    payload = request.get_json(silent=True) or {}
    try:
        return jsonify(reset_password(payload))
    except ValidationError as exc:
        return jsonify({"error": str(exc)}), 400
    except AuthenticationError as exc:
        return jsonify({"error": str(exc)}), 401
    except Exception as exc:  # pragma: no cover
        return jsonify({"error": f"Unable to reset password: {exc}"}), 500
