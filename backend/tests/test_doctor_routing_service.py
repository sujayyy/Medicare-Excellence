from services.symptom_extraction_service import extract_symptom_entities
from services.doctor_routing_service import (
    get_specialty_label,
    get_specialty_match,
    infer_specialty,
    rank_specialties,
)


def _match(text):
    entities = extract_symptom_entities(text)
    return get_specialty_match(user_message=text, entities=entities)


def test_chest_pain_routes_to_cardiology():
    result = _match("I have chest pain and shortness of breath")
    assert result["specialty"] == "cardiology"


def test_headache_and_blurred_vision_routes_to_neurology():
    result = _match("Severe headache with blurred vision and dizziness")
    assert result["specialty"] == "neurology"


def test_rash_and_itching_routes_to_dermatology():
    result = _match("I have a skin rash and itching after eating shellfish")
    assert result["specialty"] == "dermatology"


def test_generic_message_falls_back_to_general_medicine():
    result = _match("I have no specific complaints today")
    assert result["specialty"] == "general_medicine"
    assert infer_specialty(user_message="I have no specific complaints today") == "general_medicine"


def test_rank_specialties_sorted_descending_by_score():
    entities = extract_symptom_entities("I have chest pain radiating to my left arm")
    rankings = rank_specialties(user_message="I have chest pain radiating to my left arm", entities=entities)
    scores = [item["score"] for item in rankings]
    assert scores == sorted(scores, reverse=True)
    assert rankings[0]["specialty"] == "cardiology"


def test_get_specialty_match_includes_alternatives():
    result = _match("I have chest pain and shortness of breath")
    assert "alternatives" in result
    assert isinstance(result["alternatives"], list)


def test_specialty_label_lookup():
    assert get_specialty_label("cardiology") == "Cardiology"
    assert get_specialty_label("not_a_real_specialty") == "General Medicine"
    assert get_specialty_label(None) == "General Medicine"


def test_abdominal_pain_routes_to_gastroenterology():
    result = _match("I have abdominal pain and vomiting for 1 day")
    assert result["specialty"] == "gastroenterology"
