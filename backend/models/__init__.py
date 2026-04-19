from models.access_request_model import ensure_access_request_indexes
from models.alert_model import ensure_alert_indexes
from models.appointment_model import ensure_appointment_indexes
from models.chat_model import ensure_chat_indexes
from models.document_model import ensure_document_indexes
from models.emergency_model import ensure_emergency_indexes
from models.patient_model import ensure_patient_indexes
from models.user_model import ensure_user_indexes
from models.vital_model import ensure_vital_indexes


def ensure_indexes() -> None:
    ensure_access_request_indexes()
    ensure_user_indexes()
    ensure_patient_indexes()
    ensure_emergency_indexes()
    ensure_chat_indexes()
    ensure_alert_indexes()
    ensure_appointment_indexes()
    ensure_document_indexes()
    ensure_vital_indexes()
