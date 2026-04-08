from functools import wraps
from typing import Any, Callable, Optional

from flask import current_app, g, jsonify, request
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer
from werkzeug.security import check_password_hash, generate_password_hash

from models.base import serialize_document
from models.patient_model import create_or_update_patient_profile, get_patient_by_user_id
from models.user_model import (
    DEFAULT_HOSPITAL_ID,
    DEFAULT_DOCTOR_SPECIALTY,
    create_user,
    get_user_by_email,
    get_user_by_id,
    get_users_by_email,
    migrate_legacy_password,
    update_user_fields,
    sanitize_user,
    update_last_login,
)


TOKEN_MAX_AGE_SECONDS = 60 * 60 * 24 * 7
ALLOWED_ROLES = {"patient", "doctor", "hospital_admin"}
PASSWORD_HASH_METHOD = "pbkdf2:sha256"
DEFAULT_LEGACY_ROLE = "patient"
ALLOWED_SPECIALTIES = {"general_medicine", "cardiology", "pulmonology", "neurology", "endocrinology"}


class ValidationError(ValueError):
    pass


class AuthenticationError(ValueError):
    pass


def _default_name_from_email(email: str) -> str:
    local_part = (email or "patient").split("@", 1)[0].replace(".", " ").replace("_", " ").replace("-", " ").strip()
    return local_part.title() or "Patient"


def _normalize_user_record(user: dict[str, Any]) -> dict[str, Any]:
    updates: dict[str, Any] = {}

    role = user.get("role")
    if role == "admin":
        updates["role"] = "hospital_admin"
    elif role not in ALLOWED_ROLES:
        updates["role"] = DEFAULT_LEGACY_ROLE

    if not user.get("name"):
        updates["name"] = _default_name_from_email(user.get("email", ""))

    if not user.get("hospital_id"):
        updates["hospital_id"] = DEFAULT_HOSPITAL_ID

    specialty = user.get("specialty")
    if user.get("role") == "doctor":
        if specialty not in ALLOWED_SPECIALTIES:
            updates["specialty"] = DEFAULT_DOCTOR_SPECIALTY
    elif user.get("role") == "hospital_admin":
        if specialty != "operations":
            updates["specialty"] = "operations"
    elif specialty:
        updates["specialty"] = None

    if updates:
        update_user_fields(str(user["_id"]), set_fields=updates)
        user = {**user, **updates}

    return user


def _serializer() -> URLSafeTimedSerializer:
    return URLSafeTimedSerializer(current_app.config["SECRET_KEY"], salt="medicare-excellence-auth")


def _token_payload(user: dict[str, Any]) -> dict[str, str]:
    normalized_user = _normalize_user_record(user)
    return {"user_id": str(normalized_user["_id"]), "role": normalized_user["role"]}


def _build_auth_response(user: dict[str, Any]) -> dict[str, Any]:
    normalized_user = _normalize_user_record(user)
    safe_user = sanitize_user(normalized_user)
    token = _serializer().dumps(_token_payload(normalized_user))
    profile = serialize_document(get_patient_by_user_id(safe_user["id"])) if safe_user["role"] == "patient" else None
    return {"token": token, "role": safe_user["role"], "user": safe_user, "profile": profile}


def _validate_email(email: str) -> str:
    email = (email or "").strip().lower()
    if "@" not in email or "." not in email.split("@")[-1]:
        raise ValidationError("Enter a valid email address.")
    return email


def _validate_password(password: str) -> str:
    password = password or ""
    if len(password) < 6:
        raise ValidationError("Password must be at least 6 characters long.")
    return password


def _validate_role(role: str) -> str:
    role = (role or "patient").strip().lower()
    if role not in ALLOWED_ROLES:
        raise ValidationError("Role must be one of 'patient', 'doctor', or 'hospital_admin'.")
    return role


def _validate_specialty(role: str, specialty: Optional[str]) -> Optional[str]:
    normalized = (specialty or "").strip().lower()
    if role == "doctor":
        if not normalized:
            return DEFAULT_DOCTOR_SPECIALTY
        if normalized not in ALLOWED_SPECIALTIES:
            raise ValidationError("Doctor specialty must be one of cardiology, pulmonology, neurology, endocrinology, or general_medicine.")
        return normalized
    if role == "hospital_admin":
        return "operations"
    return None


def register_user(payload: dict[str, Any]) -> dict[str, Any]:
    name = (payload.get("name") or "").strip()
    email = _validate_email(payload.get("email"))
    password = _validate_password(payload.get("password"))
    role = _validate_role(payload.get("role"))
    specialty = _validate_specialty(role, payload.get("specialty"))
    hospital_id = (payload.get("hospital_id") or DEFAULT_HOSPITAL_ID).strip() or DEFAULT_HOSPITAL_ID

    if not name:
        raise ValidationError("Name is required.")

    if get_user_by_email(email):
        raise AuthenticationError("An account with this email already exists.")

    user = create_user(
        name,
        email,
        generate_password_hash(password, method=PASSWORD_HASH_METHOD),
        role,
        hospital_id=hospital_id,
        specialty=specialty,
    )
    if role == "patient":
        create_or_update_patient_profile(user)
    return _build_auth_response(user)


def _password_matches(user: dict[str, Any], password: str) -> bool:
    password_hash = user.get("password_hash")
    if password_hash:
        return check_password_hash(password_hash, password)

    legacy_password = user.get("password")
    if legacy_password and legacy_password == password:
        migrate_legacy_password(str(user["_id"]), generate_password_hash(password, method=PASSWORD_HASH_METHOD))
        return True

    return False


def login_user(payload: dict[str, Any]) -> dict[str, Any]:
    email = _validate_email(payload.get("email"))
    password = payload.get("password") or ""

    user = next((candidate for candidate in get_users_by_email(email) if _password_matches(candidate, password)), None)
    if not user:
        raise AuthenticationError("Invalid email or password.")

    user = _normalize_user_record(user)
    update_last_login(str(user["_id"]))
    refreshed_user = get_user_by_id(str(user["_id"])) or user
    refreshed_user = _normalize_user_record(refreshed_user)
    if refreshed_user["role"] == "patient":
        create_or_update_patient_profile(refreshed_user)
    return _build_auth_response(refreshed_user)


def _get_token_from_request() -> Optional[str]:
    authorization = request.headers.get("Authorization", "")
    if authorization.startswith("Bearer "):
        return authorization.replace("Bearer ", "", 1).strip()
    return None


def get_authenticated_user() -> dict[str, Any]:
    token = _get_token_from_request()
    if not token:
        raise AuthenticationError("Authentication required.")

    try:
        payload = _serializer().loads(token, max_age=TOKEN_MAX_AGE_SECONDS)
    except SignatureExpired as exc:
        raise AuthenticationError("Your session has expired. Please log in again.") from exc
    except BadSignature as exc:
        raise AuthenticationError("Invalid authentication token.") from exc

    user = get_user_by_id(payload.get("user_id"))
    if not user:
        raise AuthenticationError("User account not found.")
    return _normalize_user_record(user)


def get_optional_authenticated_user() -> Optional[dict[str, Any]]:
    token = _get_token_from_request()
    if not token:
        return None

    try:
        return get_authenticated_user()
    except AuthenticationError:
        return None


def get_current_user_response() -> dict[str, Any]:
    user = _normalize_user_record(g.current_user)
    return {
        "role": user["role"],
        "user": sanitize_user(user),
        "profile": serialize_document(get_patient_by_user_id(str(user["_id"]))) if user["role"] == "patient" else None,
    }


def require_auth(function: Callable):
    @wraps(function)
    def wrapper(*args, **kwargs):
        try:
            g.current_user = get_authenticated_user()
        except AuthenticationError as exc:
            return jsonify({"error": str(exc)}), 401
        return function(*args, **kwargs)

    return wrapper


def require_role(*roles: str):
    def decorator(function: Callable):
        @wraps(function)
        @require_auth
        def wrapper(*args, **kwargs):
            if g.current_user["role"] not in roles:
                return jsonify({"error": "You do not have access to this resource."}), 403
            return function(*args, **kwargs)

        return wrapper

    return decorator
