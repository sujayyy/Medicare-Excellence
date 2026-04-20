from __future__ import annotations

import json
import os
from collections import Counter
from typing import Any

from services.doctor_routing_service import get_specialty_match
from services.symptom_extraction_service import extract_symptom_entities
from services.triage_service import assess_triage


TRIAGE_DATASET: list[dict[str, str]] = [
    {"text": "I have mild cough and sore throat since yesterday", "triage": "Low", "specialty": "ent"},
    {"text": "I want to book a routine diabetes follow-up", "triage": "Low", "specialty": "endocrinology"},
    {"text": "I have headache and dizziness for 2 days", "triage": "Medium", "specialty": "neurology"},
    {"text": "I have fever, cough and body ache since this morning", "triage": "Medium", "specialty": "pulmonology"},
    {"text": "I have abdominal pain and vomiting for 1 day", "triage": "Medium", "specialty": "gastroenterology"},
    {"text": "I have skin rash and itching after food", "triage": "Low", "specialty": "dermatology"},
    {"text": "I have chest pain and shortness of breath", "triage": "High", "specialty": "cardiology"},
    {"text": "My blood pressure is high with severe headache and blurred vision", "triage": "High", "specialty": "neurology"},
    {"text": "I have blood in urine and swelling in my legs", "triage": "High", "specialty": "nephrology"},
    {"text": "I cannot breathe and feel severe chest pain in my left arm", "triage": "Critical", "specialty": "cardiology"},
    {"text": "My father had a seizure and is unconscious", "triage": "Critical", "specialty": "neurology"},
    {"text": "There is heavy bleeding after delivery and she feels faint", "triage": "Critical", "specialty": "gynecology"},
]

TRIAGE_LABELS = ["Low", "Medium", "High", "Critical"]
ARTIFACT_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "model_artifacts")
ARTIFACT_PATH = os.path.join(ARTIFACT_DIR, "clinical_model_report.json")


def _baseline_triage(text: str) -> str:
    lowered = (text or "").lower()
    if any(token in lowered for token in ["cannot breathe", "unconscious", "seizure", "heavy bleeding"]):
        return "Critical"
    if any(token in lowered for token in ["chest pain", "shortness of breath", "blood in urine", "blurred vision"]):
        return "High"
    if any(token in lowered for token in ["headache", "fever", "vomiting", "abdominal pain", "cough"]):
        return "Medium"
    return "Low"


def _baseline_specialty(text: str) -> str:
    lowered = (text or "").lower()
    if any(token in lowered for token in ["chest pain", "left arm", "palpitations", "blood pressure"]):
        return "cardiology"
    if any(token in lowered for token in ["headache", "blurred vision", "seizure", "dizziness"]):
        return "neurology"
    if any(token in lowered for token in ["cough", "breathing", "shortness of breath"]):
        return "pulmonology"
    if any(token in lowered for token in ["stomach", "abdominal pain", "vomiting"]):
        return "gastroenterology"
    if any(token in lowered for token in ["rash", "itching", "skin"]):
        return "dermatology"
    if any(token in lowered for token in ["period", "delivery", "pregnancy", "pelvic"]):
        return "gynecology"
    if any(token in lowered for token in ["diabetes", "glucose", "sugar", "thyroid"]):
        return "endocrinology"
    if any(token in lowered for token in ["urine", "kidney", "swelling"]):
        return "nephrology"
    if any(token in lowered for token in ["throat", "ear", "nose", "sore throat"]):
        return "ent"
    return "general_medicine"


def _accuracy(truth: list[str], pred: list[str]) -> float:
    if not truth:
        return 0.0
    return round(sum(1 for expected, predicted in zip(truth, pred) if expected == predicted) / len(truth), 3)


def _macro_f1(truth: list[str], pred: list[str], labels: list[str]) -> float:
    f1_values: list[float] = []
    for label in labels:
        tp = sum(1 for expected, predicted in zip(truth, pred) if expected == label and predicted == label)
        fp = sum(1 for expected, predicted in zip(truth, pred) if expected != label and predicted == label)
        fn = sum(1 for expected, predicted in zip(truth, pred) if expected == label and predicted != label)
        precision = tp / (tp + fp) if (tp + fp) else 0.0
        recall = tp / (tp + fn) if (tp + fn) else 0.0
        f1 = (2 * precision * recall / (precision + recall)) if (precision + recall) else 0.0
        f1_values.append(f1)
    return round(sum(f1_values) / len(f1_values), 3) if f1_values else 0.0


def _confusion_matrix(truth: list[str], pred: list[str], labels: list[str]) -> list[dict[str, Any]]:
    rows = []
    for expected in labels:
        counts = Counter(predicted for truth_label, predicted in zip(truth, pred) if truth_label == expected)
        row = {"label": expected}
        for label in labels:
            row[label] = counts.get(label, 0)
        rows.append(row)
    return rows


def _save_artifact(payload: dict[str, Any]) -> dict[str, Any]:
    os.makedirs(ARTIFACT_DIR, exist_ok=True)
    with open(ARTIFACT_PATH, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2)
    return {
        "artifact_path": ARTIFACT_PATH,
        "artifact_saved": True,
    }


def evaluate_model_stack() -> dict[str, Any]:
    truth_triage = [entry["triage"] for entry in TRIAGE_DATASET]
    truth_specialty = [entry["specialty"] for entry in TRIAGE_DATASET]

    model_triage: list[str] = []
    model_specialty: list[str] = []
    baseline_triage: list[str] = []
    baseline_specialty: list[str] = []
    samples: list[dict[str, Any]] = []

    for entry in TRIAGE_DATASET:
        entities = extract_symptom_entities(entry["text"])
        triage_result = assess_triage(entry["text"], entities=entities)
        specialty_result = get_specialty_match(user_message=entry["text"], entities=entities)
        baseline_triage_label = _baseline_triage(entry["text"])
        baseline_specialty_label = _baseline_specialty(entry["text"])

        model_triage.append(triage_result["triage_label"])
        model_specialty.append(specialty_result["specialty"])
        baseline_triage.append(baseline_triage_label)
        baseline_specialty.append(baseline_specialty_label)

        if len(samples) < 5:
            samples.append(
                {
                    "text": entry["text"],
                    "expected_triage": entry["triage"],
                    "predicted_triage": triage_result["triage_label"],
                    "triage_confidence": triage_result.get("triage_confidence", 0),
                    "expected_specialty": entry["specialty"],
                    "predicted_specialty": specialty_result["specialty"],
                    "specialty_reason": specialty_result.get("reason", ""),
                }
            )

    transformer_enabled = bool(os.getenv("GEMINI_API_KEY"))
    result = {
        "dataset_size": len(TRIAGE_DATASET),
        "embedding_backend": "gemini-text-embedding-004" if transformer_enabled else "hashing-vectorizer-medical-v1",
        "transformer_enabled": transformer_enabled,
        "triage_model_version": "transformer-semantic-triage-v3",
        "specialty_model_version": "transformer-semantic-specialty-v3",
        "triage_accuracy": _accuracy(truth_triage, model_triage),
        "triage_macro_f1": _macro_f1(truth_triage, model_triage, TRIAGE_LABELS),
        "triage_baseline_accuracy": _accuracy(truth_triage, baseline_triage),
        "specialty_accuracy": _accuracy(truth_specialty, model_specialty),
        "specialty_baseline_accuracy": _accuracy(truth_specialty, baseline_specialty),
        "triage_confusion_matrix": _confusion_matrix(truth_triage, model_triage, TRIAGE_LABELS),
        "sample_predictions": samples,
    }
    result.update(_save_artifact(result))
    return result
