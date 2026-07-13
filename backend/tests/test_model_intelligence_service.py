from services.model_intelligence_service import TRIAGE_DATASET, evaluate_model_stack


def test_dataset_has_at_least_100_examples():
    assert len(TRIAGE_DATASET) >= 100


def test_dataset_covers_all_triage_labels():
    labels = {entry["triage"] for entry in TRIAGE_DATASET}
    assert labels == {"Low", "Medium", "High", "Critical"}


def test_evaluate_model_stack_returns_expected_keys():
    result = evaluate_model_stack()
    assert result["dataset_size"] == len(TRIAGE_DATASET)
    assert 0.0 <= result["triage_accuracy"] <= 1.0
    assert 0.0 <= result["triage_macro_f1"] <= 1.0
    assert 0.0 <= result["specialty_accuracy"] <= 1.0
    assert len(result["triage_confusion_matrix"]) == 4
