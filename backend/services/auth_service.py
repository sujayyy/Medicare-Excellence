import os
import smtplib
from email.message import EmailMessage
from functools import wraps
from typing import Any, Callable, Optional

from flask import current_app, g, jsonify, request
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer
from werkzeug.security import check_password_hash, generate_password_hash

from models.base import serialize_document, utc_now
from models.access_request_model import get_active_access_request_by_email
from models.patient_model import calculate_age_from_dob, create_or_update_patient_profile, get_patient_by_user_id
from models.user_model import (
    DEFAULT_HOSPITAL_ID,
    DEFAULT_DOCTOR_SPECIALTY,
    create_user,
    get_user_by_email,
    get_user_by_id,
    get_users_by_email,
    list_users_by_role,
    migrate_legacy_password,
    update_user_fields,
    sanitize_user,
    update_last_login,
)
from services.access_request_service import submit_doctor_access_request


TOKEN_MAX_AGE_SECONDS = 60 * 60 * 24 * 7
EMAIL_VERIFICATION_TOKEN_MAX_AGE_SECONDS = 60 * 60 * 24
PASSWORD_RESET_TOKEN_MAX_AGE_SECONDS = 60 * 60
ALLOWED_ROLES = {"patient", "doctor", "hospital_admin"}
PASSWORD_HASH_METHOD = "pbkdf2:sha256"
DEFAULT_LEGACY_ROLE = "patient"
ALLOWED_SPECIALTIES = {
    "general_medicine",
    "cardiology",
    "pulmonology",
    "neurology",
    "endocrinology",
    "dermatology",
    "orthopedics",
    "pediatrics",
    "psychiatry",
    "ent",
    "gynecology",
    "gastroenterology",
    "nephrology",
    "oncology",
    "ophthalmology",
}
ALLOWED_GENDERS = {"male", "female", "other", "prefer_not_to_say"}


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

    if user.get("email_verified") is None:
        updates["email_verified"] = False
    if "email_verified_at" not in user:
        updates["email_verified_at"] = None
    if "verification_sent_at" not in user:
        updates["verification_sent_at"] = None
    if "password_reset_sent_at" not in user:
        updates["password_reset_sent_at"] = None

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


def _verification_serializer() -> URLSafeTimedSerializer:
    return URLSafeTimedSerializer(current_app.config["SECRET_KEY"], salt="medicare-excellence-email-verify")


def _password_reset_serializer() -> URLSafeTimedSerializer:
    return URLSafeTimedSerializer(current_app.config["SECRET_KEY"], salt="medicare-excellence-password-reset")


def _frontend_base_url() -> str:
    return os.getenv("FRONTEND_BASE_URL", "http://127.0.0.1:8080").rstrip("/")


def _send_email(*, to_email: str, subject: str, text_body: str, html_body: str, action_url: str) -> dict[str, Any]:
    smtp_host = os.getenv("SMTP_HOST", "").strip()
    preview_payload = {"preview_url": action_url, "delivery": "preview"}

    if not smtp_host:
        current_app.logger.info("Email preview for %s: %s", to_email, action_url)
        return preview_payload

    message = EmailMessage()
    message["Subject"] = subject
    message["From"] = os.getenv("SMTP_FROM_EMAIL", os.getenv("SMTP_USERNAME", "no-reply@medicare-excellence.local"))
    message["To"] = to_email
    message.set_content(text_body)
    message.add_alternative(html_body, subtype="html")

    smtp_port = int(os.getenv("SMTP_PORT", "587"))
    smtp_username = os.getenv("SMTP_USERNAME", "").strip()
    smtp_password = os.getenv("SMTP_PASSWORD", "")
    use_ssl = os.getenv("SMTP_USE_SSL", "false").lower() == "true"
    use_tls = os.getenv("SMTP_USE_TLS", "true").lower() == "true"

    try:
        if use_ssl:
            with smtplib.SMTP_SSL(smtp_host, smtp_port, timeout=15) as server:
                if smtp_username:
                    server.login(smtp_username, smtp_password)
                server.send_message(message)
        else:
            with smtplib.SMTP(smtp_host, smtp_port, timeout=15) as server:
                if use_tls:
                    server.starttls()
                if smtp_username:
                    server.login(smtp_username, smtp_password)
                server.send_message(message)
        return {"delivery": "email"}
    except Exception as exc:  # pragma: no cover - SMTP env dependent
        current_app.logger.warning("SMTP delivery failed for %s: %s", to_email, exc)
        return preview_payload


def _token_payload(user: dict[str, Any]) -> dict[str, str]:
    normalized_user = _normalize_user_record(user)
    return {"user_id": str(normalized_user["_id"]), "role": normalized_user["role"]}


def _build_auth_response(user: dict[str, Any]) -> dict[str, Any]:
    normalized_user = _normalize_user_record(user)
    safe_user = sanitize_user(normalized_user)
    token = _serializer().dumps(_token_payload(normalized_user))
    profile = serialize_document(get_patient_by_user_id(safe_user["id"])) if safe_user["role"] == "patient" else None
    return {"token": token, "role": safe_user["role"], "user": safe_user, "profile": profile}


def send_verification_for_user(user: dict[str, Any]) -> dict[str, Any]:
    normalized_user = _normalize_user_record(user)
    token = _verification_serializer().dumps({"user_id": str(normalized_user["_id"]), "email": normalized_user["email"]})
    verify_url = f"{_frontend_base_url()}/verify-email?token={token}"
    delivery = _send_email(
        to_email=normalized_user["email"],
        subject="Verify your Medicare Excellence account",
        action_url=verify_url,
        text_body=(
            f"Hello {normalized_user.get('name', 'there')},\n\n"
            "Please verify your Medicare Excellence account using the link below:\n"
            f"{verify_url}\n\n"
            "If you did not create this account, you can ignore this email."
        ),
        html_body=(
            f"<p>Hello {normalized_user.get('name', 'there')},</p>"
            "<p>Please verify your Medicare Excellence account using the link below:</p>"
            f"<p><a href=\"{verify_url}\">Verify email</a></p>"
            "<p>If you did not create this account, you can ignore this email.</p>"
        ),
    )
    update_user_fields(str(normalized_user["_id"]), set_fields={"verification_sent_at": utc_now()})
    return {"message": "Verification link sent to your email address.", **delivery}


def _send_password_reset_for_user(user: dict[str, Any]) -> dict[str, Any]:
    normalized_user = _normalize_user_record(user)
    token = _password_reset_serializer().dumps({"user_id": str(normalized_user["_id"]), "email": normalized_user["email"]})
    reset_url = f"{_frontend_base_url()}/reset-password?token={token}"
    delivery = _send_email(
        to_email=normalized_user["email"],
        subject="Reset your Medicare Excellence password",
        action_url=reset_url,
        text_body=(
            f"Hello {normalized_user.get('name', 'there')},\n\n"
            "You can reset your Medicare Excellence password using the link below:\n"
            f"{reset_url}\n\n"
            "If you did not request this, you can ignore this email."
        ),
        html_body=(
            f"<p>Hello {normalized_user.get('name', 'there')},</p>"
            "<p>You can reset your Medicare Excellence password using the link below:</p>"
            f"<p><a href=\"{reset_url}\">Reset password</a></p>"
            "<p>If you did not request this, you can ignore this email.</p>"
        ),
    )
    update_user_fields(str(normalized_user["_id"]), set_fields={"password_reset_sent_at": utc_now()})
    return {"message": "Password reset instructions have been sent if the account exists.", **delivery}


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
            raise ValidationError("Please choose a valid doctor specialty from the available hospital list.")
        return normalized
    if role == "hospital_admin":
        return "operations"
    return None


def _validate_patient_phone(phone: Optional[str]) -> str:
    normalized = " ".join((phone or "").strip().split())
    if not normalized:
        return ""
    digits = "".join(character for character in normalized if character.isdigit())
    if len(digits) < 7 or len(digits) > 15:
        raise ValidationError("Please enter a valid phone number.")
    return normalized


def _validate_patient_gender(gender: Optional[str]) -> str:
    normalized = (gender or "").strip().lower()
    if normalized not in ALLOWED_GENDERS:
        raise ValidationError("Please choose a valid gender option.")
    return normalized


def _validate_patient_dob(dob: Optional[str]) -> str:
    normalized = (dob or "").strip()
    age = calculate_age_from_dob(normalized)
    if not normalized or age is None:
        raise ValidationError("Please enter a valid date of birth.")
    return normalized


def _validate_patient_profile_fields(role: str, payload: dict[str, Any]) -> dict[str, Any]:
    if role != "patient":
        return {}

    dob = _validate_patient_dob(payload.get("dob"))
    gender = _validate_patient_gender(payload.get("gender"))
    phone = _validate_patient_phone(payload.get("phone"))
    return {
        "dob": dob,
        "gender": gender,
        "phone": phone,
        "age": calculate_age_from_dob(dob),
    }


def _resolve_hospital_id(requested_hospital_id: Any) -> str:
    normalized = (requested_hospital_id or "").strip()
    if normalized:
        return normalized

    hospital_admins = list_users_by_role("hospital_admin")
    if hospital_admins:
        return (hospital_admins[0].get("hospital_id") or DEFAULT_HOSPITAL_ID).strip() or DEFAULT_HOSPITAL_ID

    return DEFAULT_HOSPITAL_ID


def register_user(payload: dict[str, Any]) -> dict[str, Any]:
    name = (payload.get("name") or "").strip()
    email = _validate_email(payload.get("email"))
    password = _validate_password(payload.get("password"))
    role = _validate_role(payload.get("role"))
    specialty = _validate_specialty(role, payload.get("specialty"))
    hospital_id = _resolve_hospital_id(payload.get("hospital_id"))
    patient_profile_fields = _validate_patient_profile_fields(role, payload)

    if not name:
        raise ValidationError("Name is required.")

    if get_user_by_email(email):
        raise AuthenticationError("An account with this email already exists.")

    if role == "hospital_admin":
        if list_users_by_role("hospital_admin", hospital_id=hospital_id):
            raise AuthenticationError("Hospital admin access is managed internally by the current admin.")

    if role == "doctor":
        access_request = submit_doctor_access_request(
            name=name,
            email=email,
            password=password,
            specialty=specialty or DEFAULT_DOCTOR_SPECIALTY,
            hospital_id=hospital_id,
        )
        return {
            "requires_approval": True,
            "role": "doctor",
            "message": "Doctor access request submitted. You can sign in after the hospital admin approves it.",
            "request": access_request,
        }

    user = create_user(
        name,
        email,
        generate_password_hash(password, method=PASSWORD_HASH_METHOD),
        role,
        hospital_id=hospital_id,
        specialty=specialty,
        phone=patient_profile_fields.get("phone"),
        dob=patient_profile_fields.get("dob"),
        gender=patient_profile_fields.get("gender"),
    )
    if role == "patient":
        create_or_update_patient_profile(user)
    update_user_fields(
        str(user["_id"]),
        set_fields={
            "email_verified": True,
            "email_verified_at": utc_now(),
        },
    )
    refreshed_user = get_user_by_id(str(user["_id"])) or user
    return _build_auth_response(refreshed_user)


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
        request_record = get_active_access_request_by_email(email)
        if request_record:
            if request_record.get("status") == "pending":
                raise AuthenticationError("Doctor access is waiting for hospital admin approval.")
            if request_record.get("status") == "approved":
                raise AuthenticationError("This doctor access was approved, but the account is not ready yet. Please contact the admin.")
        raise AuthenticationError("Invalid email or password.")

    user = _normalize_user_record(user)
    update_last_login(str(user["_id"]))
    refreshed_user = get_user_by_id(str(user["_id"])) or user
    refreshed_user = _normalize_user_record(refreshed_user)
    if refreshed_user["role"] == "patient":
        create_or_update_patient_profile(refreshed_user)
    return _build_auth_response(refreshed_user)


def resend_verification_email(payload: dict[str, Any]) -> dict[str, Any]:
    email = _validate_email(payload.get("email"))
    user = get_user_by_email(email)
    if not user:
        return {"message": "If an account exists for this email, a verification link has been sent."}

    user = _normalize_user_record(user)
    if user.get("email_verified"):
        return {"message": "This email address is already verified."}

    delivery = send_verification_for_user(user)
    return {"message": "Verification link sent.", "email": email, **delivery}


def verify_email_token(payload: dict[str, Any]) -> dict[str, Any]:
    token = (payload.get("token") or "").strip()
    if not token:
        raise ValidationError("Verification token is required.")

    try:
        data = _verification_serializer().loads(token, max_age=EMAIL_VERIFICATION_TOKEN_MAX_AGE_SECONDS)
    except SignatureExpired as exc:
        raise AuthenticationError("This verification link has expired. Request a new one.") from exc
    except BadSignature as exc:
        raise AuthenticationError("This verification link is invalid.") from exc

    user = get_user_by_id(data.get("user_id"))
    if not user:
        raise AuthenticationError("User account not found.")

    user = _normalize_user_record(user)
    if user.get("email") != data.get("email"):
        raise AuthenticationError("This verification link does not match the account.")

    if not user.get("email_verified"):
        update_user_fields(
            str(user["_id"]),
            set_fields={
                "email_verified": True,
                "email_verified_at": utc_now(),
            },
        )
        user = get_user_by_id(str(user["_id"])) or user

    safe_user = sanitize_user(_normalize_user_record(user))
    return {
        "message": "Email verified successfully. You can now sign in.",
        "role": safe_user["role"],
        "user": safe_user,
    }


def request_password_reset(payload: dict[str, Any]) -> dict[str, Any]:
    email = _validate_email(payload.get("email"))
    user = get_user_by_email(email)
    if not user:
        return {"message": "If an account exists for this email, password reset instructions have been sent."}

    user = _normalize_user_record(user)
    return {"email": email, **_send_password_reset_for_user(user)}


def reset_password(payload: dict[str, Any]) -> dict[str, Any]:
    token = (payload.get("token") or "").strip()
    password = _validate_password(payload.get("password"))
    if not token:
        raise ValidationError("Reset token is required.")

    try:
        data = _password_reset_serializer().loads(token, max_age=PASSWORD_RESET_TOKEN_MAX_AGE_SECONDS)
    except SignatureExpired as exc:
        raise AuthenticationError("This reset link has expired. Request a new one.") from exc
    except BadSignature as exc:
        raise AuthenticationError("This reset link is invalid.") from exc

    user = get_user_by_id(data.get("user_id"))
    if not user:
        raise AuthenticationError("User account not found.")

    user = _normalize_user_record(user)
    if user.get("email") != data.get("email"):
        raise AuthenticationError("This reset link does not match the account.")

    update_user_fields(
        str(user["_id"]),
        set_fields={
            "password_hash": generate_password_hash(password, method=PASSWORD_HASH_METHOD),
            "password_reset_sent_at": utc_now(),
        },
        unset_fields={"password": ""},
    )
    return {"message": "Password updated successfully. You can now sign in."}


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
