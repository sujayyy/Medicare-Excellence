from services.symptom_extraction_service import extract_symptom_entities
from services.triage_service import assess_triage

VALID_LABELS = {"Low", "Medium", "High", "Critical"}


def _assess(text, **kwargs):
    entities = extract_symptom_entities(text)
    return assess_triage(text, entities=entities, **kwargs)


def test_emergency_flag_always_returns_critical():
    result = _assess("I have a mild headache", emergency=True)
    assert result["triage_label"] == "Critical"
    assert result["triage_score"] == 95
    assert result["triage_confidence"] == 0.99


def test_critical_phrase_combination_scores_critical():
    result = _assess("I cannot breathe and feel severe chest pain in my left arm")
    assert result["triage_label"] == "Critical"
    assert result["triage_score"] >= 85


def test_low_severity_message_scores_low():
    result = _assess("I have mild cough and sore throat since yesterday")
    assert result["triage_label"] == "Low"


def test_medium_severity_message_scores_medium_or_higher():
    result = _assess("I have headache and dizziness for 2 days")
    assert result["triage_label"] in {"Medium", "High"}


def test_appointment_context_without_red_flags_downgrades_to_low():
    result = _assess("I want to book a routine diabetes follow-up", appointment=True)
    assert result["triage_label"] == "Low"
    assert result["triage_score"] == 30
    assert result["triage_confidence"] == 0.82


def test_appointment_context_with_red_flags_is_not_forced_low():
    result = _assess("I want to book an appointment but I have chest pain and shortness of breath", appointment=True)
    assert result["triage_label"] != "Low" or result["triage_score"] != 30


def test_urgent_red_flags_prevent_low_classification():
    result = _assess("I have chest pain")
    assert result["triage_score"] >= 62
    assert result["triage_label"] in {"High", "Critical"}


def test_output_shape_and_bounds():
    result = _assess("I have a mild headache")
    assert result["triage_label"] in VALID_LABELS
    assert 0 <= result["triage_score"] <= 99
    assert 0.0 <= result["triage_confidence"] <= 0.99
    assert isinstance(result["triage_factors"], list)
    assert "triage_evidence" in result
    assert "recommended_action" in result


def test_empty_message_does_not_raise_and_scores_low():
    result = _assess("")
    assert result["triage_label"] == "Low"


def test_sudden_onset_headache_is_escalated():
    result = _assess("I suddenly have a headache since this morning")
    assert result["triage_score"] >= 58
