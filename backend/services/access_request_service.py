from typing import Any

from werkzeug.security import generate_password_hash

from models.access_request_model import (
    create_access_request,
    get_access_request_by_id,
    get_active_access_request_by_email,
    list_access_requests,
    update_access_request,
)
from models.alert_model import create_alert
from models.user_model import DEFAULT_HOSPITAL_ID, create_user, get_user_by_email
from models.base import utc_now

PASSWORD_HASH_METHOD = "pbkdf2:sha256"


class ValidationError(ValueError):
    pass


def _sanitize_request(access_request: dict[str, Any]) -> dict[str, Any]:
    sanitized = dict(access_request)
    sanitized.pop("password_hash", None)
    return sanitized


def submit_doctor_access_request(
    *,
    name: str,
    email: str,
    password: str,
    specialty: str,
    hospital_id: str = DEFAULT_HOSPITAL_ID,
) -> dict[str, Any]:
    if get_user_by_email(email):
        raise ValidationError("An account with this email already exists.")

    existing_request = get_active_access_request_by_email(email)
    if existing_request and existing_request.get("status") == "pending":
        raise ValidationError("This doctor access request is already waiting for admin approval.")

    access_request = create_access_request(
        {
            "name": name,
            "email": email.strip().lower(),
            "password_hash": generate_password_hash(password, method=PASSWORD_HASH_METHOD),
            "requested_role": "doctor",
            "specialty": specialty,
            "hospital_id": hospital_id,
            "status": "pending",
        }
    )

    create_alert(
        {
            "type": "doctor_access_request",
            "title": "New doctor access request",
            "message": f"{name} requested doctor access for {specialty.replace('_', ' ').title()}.",
            "hospital_id": hospital_id,
            "severity": "medium",
            "target_role": "hospital_admin",
            "patient_name": name,
            "patient_email": email.strip().lower(),
            "source": "access_request",
        }
    )
    return _sanitize_request(access_request)


def get_doctor_access_requests(user: dict[str, Any]) -> list[dict[str, Any]]:
    if user.get("role") != "hospital_admin":
        raise ValidationError("Only hospital admins can review doctor access requests.")

    hospital_id = user.get("hospital_id") or DEFAULT_HOSPITAL_ID

    # Backfill older pending requests that were stored under the legacy default hospital id
    # before the admin's actual hospital id was used during doctor signup.
    if hospital_id != DEFAULT_HOSPITAL_ID:
        legacy_pending = list_access_requests(hospital_id=DEFAULT_HOSPITAL_ID, status="pending")
        for request in legacy_pending:
            update_access_request(request["id"], {"hospital_id": hospital_id})

    return [_sanitize_request(item) for item in list_access_requests(hospital_id=hospital_id)]


def approve_doctor_access_request(request_id: str, user: dict[str, Any]) -> dict[str, Any]:
    if user.get("role") != "hospital_admin":
        raise ValidationError("Only hospital admins can approve doctor access requests.")

    access_request = get_access_request_by_id(request_id)
    if not access_request:
        raise ValidationError("Access request not found.")
    if access_request.get("status") != "pending":
        raise ValidationError("Only pending requests can be approved.")
    if get_user_by_email(access_request["email"]):
        raise ValidationError("A user with this email already exists.")

    doctor = create_user(
        access_request["name"],
        access_request["email"],
        access_request["password_hash"],
        "doctor",
        hospital_id=access_request.get("hospital_id") or DEFAULT_HOSPITAL_ID,
        specialty=access_request.get("specialty"),
    )
    from models.user_model import update_user_fields

    update_user_fields(
        str(doctor["_id"]),
        set_fields={
            "email_verified": True,
            "email_verified_at": utc_now(),
        },
    )

    updated_request = update_access_request(
        request_id,
        {
            "status": "approved",
            "approved_by_user_id": str(user["_id"]),
            "approved_by_name": user.get("name"),
            "doctor_user_id": str(doctor["_id"]),
            "doctor_code": doctor.get("doctor_code"),
        },
    )
    response = _sanitize_request(updated_request or access_request)
    return response


def reject_doctor_access_request(request_id: str, user: dict[str, Any]) -> dict[str, Any]:
    if user.get("role") != "hospital_admin":
        raise ValidationError("Only hospital admins can reject doctor access requests.")

    access_request = get_access_request_by_id(request_id)
    if not access_request:
        raise ValidationError("Access request not found.")
    if access_request.get("status") != "pending":
        raise ValidationError("Only pending requests can be rejected.")

    updated_request = update_access_request(
        request_id,
        {
            "status": "rejected",
            "approved_by_user_id": str(user["_id"]),
            "approved_by_name": user.get("name"),
        },
    )
    return _sanitize_request(updated_request or access_request)
