from flask import Blueprint, jsonify, request

from services.auth_service import get_optional_authenticated_user, require_auth
from services.chat_service import ValidationError, get_chat_history_response, process_chat_message

chat_blueprint = Blueprint("chat", __name__)


@chat_blueprint.post("/chat")
def chat():
    payload = request.get_json(silent=True) or {}
    try:
        user = get_optional_authenticated_user()
        response_text = process_chat_message(payload, user=user)
        return jsonify({"response": response_text})
    except ValidationError as exc:
        return jsonify({"error": str(exc)}), 400
    except Exception as exc:  # pragma: no cover - defensive API fallback
        return jsonify({"error": f"Unable to process chat request: {exc}"}), 500


@chat_blueprint.get("/chat/history")
@require_auth
def chat_history():
    return jsonify(get_chat_history_response())
