from __future__ import annotations

import base64
import io
import json
import os
import re
from typing import Any, Optional

try:
    import google.generativeai as genai
except Exception:  # pragma: no cover - optional dependency
    genai = None

try:
    from PIL import Image
except Exception:  # pragma: no cover - optional dependency
    Image = None

try:
    import pytesseract
except Exception:  # pragma: no cover - optional dependency
    pytesseract = None


TIMING_KEYWORDS = [
    ("1-1-1", ["Morning", "Noon", "Night"]),
    ("1-0-1", ["Morning", "Night"]),
    ("1-0-0", ["Morning"]),
    ("0-1-0", ["Noon"]),
    ("0-0-1", ["Night"]),
    ("tds", ["Morning", "Noon", "Night"]),
    ("tid", ["Morning", "Noon", "Night"]),
    ("bd", ["Morning", "Night"]),
    ("bid", ["Morning", "Night"]),
    ("od", ["Morning"]),
    ("qam", ["Morning"]),
    ("hs", ["Night"]),
]

DOSAGE_PATTERN = re.compile(r"(\d+(?:\.\d+)?\s?(?:mg|mcg|g|ml|iu|units?))", re.IGNORECASE)
DURATION_PATTERN = re.compile(
    r"((?:for\s+)?\d+\s*(?:day|days|week|weeks|month|months)|x\s*\d+\s*(?:day|days|week|weeks))",
    re.IGNORECASE,
)
LINE_SPLIT_PATTERN = re.compile(r"[\n;]+")
MED_NAME_PREFIXES = re.compile(r"^(tab(?:let)?|cap(?:sule)?|syrup|syp|inj(?:ection)?|drop|drops)\.?\s+", re.IGNORECASE)

COMMON_MEDICATION_TOKENS = {
    "paracetamol",
    "acetaminophen",
    "ibuprofen",
    "aspirin",
    "amoxicillin",
    "metformin",
    "insulin",
    "omeprazole",
    "cetirizine",
    "thyroxine",
    "amlodipine",
    "losartan",
    "atorvastatin",
    "pantoprazole",
    "azithromycin",
    "dolo",
    "crocin",
}

LAB_THRESHOLDS = {
    "glucose": {"high": 180, "critical": 250, "unit": "mg/dL", "label": "Glucose", "aliases": ["glucose", "blood sugar", "rbs", "fbs"]},
    "creatinine": {"high": 1.3, "critical": 2.0, "unit": "mg/dL", "label": "Creatinine", "aliases": ["creatinine"]},
    "hba1c": {"high": 6.5, "critical": 8.5, "unit": "%", "label": "HbA1c", "aliases": ["hba1c", "hb a1c", "glycated hemoglobin"]},
    "hemoglobin": {"low": 11.0, "critical_low": 8.0, "unit": "g/dL", "label": "Hemoglobin", "aliases": ["hemoglobin", "haemoglobin", "hb"]},
    "wbc": {"high": 11000, "critical": 18000, "low": 4000, "critical_low": 2500, "unit": "/uL", "label": "WBC", "aliases": ["wbc", "total leucocyte count", "tlc"]},
    "platelets": {"low": 150000, "critical_low": 50000, "unit": "/uL", "label": "Platelets", "aliases": ["platelets", "platelet count"]},
    "sodium": {"high": 145, "critical": 155, "low": 135, "critical_low": 125, "unit": "mmol/L", "label": "Sodium", "aliases": ["sodium", "na+"]},
    "potassium": {"high": 5.2, "critical": 6.0, "low": 3.5, "critical_low": 2.8, "unit": "mmol/L", "label": "Potassium", "aliases": ["potassium", "k+"]},
    "crp": {"high": 10, "critical": 50, "unit": "mg/L", "label": "CRP", "aliases": ["crp", "c-reactive protein"]},
    "troponin": {"high": 0.04, "critical": 0.4, "unit": "ng/mL", "label": "Troponin", "aliases": ["troponin", "trop i", "trop-t"]},
    "bilirubin": {"high": 1.2, "critical": 3.0, "unit": "mg/dL", "label": "Bilirubin", "aliases": ["bilirubin", "total bilirubin"]},
}

DISCHARGE_HIGH_RISK_TERMS = {
    "icu", "oxygen", "sepsis", "stroke", "mi", "myocardial infarction", "heart failure",
    "arrhythmia", "pulmonary embolism", "dvt", "acute kidney injury", "aki",
}
DISCHARGE_MODERATE_RISK_TERMS = {
    "surgery", "procedure", "fracture", "pneumonia", "dehydration", "asthma", "copd",
    "uncontrolled diabetes", "hypertensive urgency", "bleeding",
}


def _decode_data_url(file_data_url: str) -> tuple[bytes, str]:
    if not file_data_url:
        return b"", ""

    header, _, encoded = file_data_url.partition(",")
    if not encoded:
        return b"", header

    try:
        return base64.b64decode(encoded), header
    except Exception:
        return b"", header


def _looks_like_image(file_name: str, content_type: str, header: str) -> bool:
    lowered_name = (file_name or "").lower()
    lowered_type = (content_type or "").lower()
    lowered_header = (header or "").lower()
    return lowered_type.startswith("image/") or lowered_name.endswith((".png", ".jpg", ".jpeg", ".webp")) or "image/" in lowered_header


def _extract_image_text(file_bytes: bytes) -> str:
    if not file_bytes or not Image or not pytesseract:
        return ""
    try:
        image = Image.open(io.BytesIO(file_bytes))
        return " ".join((pytesseract.image_to_string(image) or "").split())
    except Exception:
        return ""


def _extract_plain_text(file_bytes: bytes, content_type: str, header: str) -> str:
    lowered_type = (content_type or "").lower()
    lowered_header = (header or "").lower()
    if "text/plain" not in lowered_type and "text/plain" not in lowered_header:
        return ""
    try:
        return file_bytes.decode("utf-8", errors="ignore")
    except Exception:
        return ""


def _normalize_ai_medication_schedule(entries: Optional[list[dict[str, Any]]]) -> list[dict[str, str]]:
    medications = []
    seen = set()

    for entry in entries or []:
        drug_name = " ".join(str(entry.get("drug_name") or "").split()).strip()
        if not drug_name:
            continue

        lowered_name = drug_name.lower()
        if lowered_name in seen:
            continue
        seen.add(lowered_name)

        medications.append(
            {
                "drug_name": drug_name,
                "dosage": " ".join(str(entry.get("dosage") or "Not specified").split()).strip() or "Not specified",
                "timing": " ".join(str(entry.get("timing") or "Follow clinician instructions").split()).strip() or "Follow clinician instructions",
                "duration": " ".join(str(entry.get("duration") or "Not specified").split()).strip() or "Not specified",
                "source_line": " ".join(str(entry.get("notes") or entry.get("source_line") or "AI handwriting interpretation").split()).strip()[:180],
            }
        )

    return medications


def _parse_json_response(raw_text: str) -> dict[str, Any]:
    cleaned = (raw_text or "").strip()
    if not cleaned:
        return {}

    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned)
        cleaned = re.sub(r"\s*```$", "", cleaned)

    start = cleaned.find("{")
    end = cleaned.rfind("}")
    if start != -1 and end != -1 and end > start:
        cleaned = cleaned[start : end + 1]

    try:
        parsed = json.loads(cleaned)
        return parsed if isinstance(parsed, dict) else {}
    except Exception:
        return {}


def _extract_multimodal_prescription(
    *,
    file_bytes: bytes,
    content_type: str,
    file_name: str,
    notes: str,
) -> dict[str, Any]:
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key or genai is None or not file_bytes:
        return {}

    try:
        genai.configure(api_key=api_key)
        model = genai.GenerativeModel("models/gemini-2.5-flash")
        response = model.generate_content(
            [
                """
You are reading a real prescription image for a healthcare app.

Return strict JSON only with this shape:
{
  "extracted_text": "clean readable transcription of the prescription",
  "medications": [
    {
      "drug_name": "",
      "dosage": "",
      "timing": "",
      "duration": "",
      "notes": ""
    }
  ],
  "interpretation_notes": "short note about ambiguous handwriting or instructions",
  "document_quality": "clear | moderate | poor"
}

Rules:
- read handwritten prescriptions as carefully as possible
- use empty strings when unsure
- timing should be patient-friendly if possible, for example "Morning, Night after food"
- do not invent medicines with high confidence if handwriting is unreadable
- if only part of the prescription is readable, return the readable part
                """,
                {
                    "mime_type": content_type or "image/jpeg",
                    "data": file_bytes,
                },
                f"Document name: {file_name or 'prescription'}\nUploader notes: {notes or 'none'}",
            ]
        )
        parsed = _parse_json_response(getattr(response, "text", "") or "")
        medications = _normalize_ai_medication_schedule(parsed.get("medications"))
        extracted_text = " ".join(str(parsed.get("extracted_text") or "").split()).strip()
        interpretation_notes = " ".join(str(parsed.get("interpretation_notes") or "").split()).strip()
        document_quality = " ".join(str(parsed.get("document_quality") or "").split()).strip().lower()

        if not extracted_text and not medications and not interpretation_notes:
            return {}

        return {
            "extracted_text": extracted_text,
            "medication_schedule": medications,
            "ai_interpretation_notes": interpretation_notes,
            "document_quality": document_quality or "moderate",
            "ocr_status": "ai_handwriting_interpreted",
            "ocr_source": "multimodal_ai_image",
            "extraction_model": "multimodal-prescription-ai-v2",
        }
    except Exception:
        return {}


def _handwriting_ai_available() -> bool:
    return bool(os.getenv("GEMINI_API_KEY") and genai is not None)


def _local_ocr_available() -> bool:
    return bool(Image is not None and pytesseract is not None)


def extract_document_text(
    *,
    notes: str,
    content_text: str,
    file_name: str = "",
    content_type: str = "",
    file_data_url: str = "",
) -> dict[str, Any]:
    file_bytes, header = _decode_data_url(file_data_url)
    ocr_text = ""
    ocr_status = "not_attempted"
    ocr_source = "manual_text"
    multimodal_result: dict[str, Any] = {}

    if _looks_like_image(file_name, content_type, header):
        multimodal_result = _extract_multimodal_prescription(
            file_bytes=file_bytes,
            content_type=content_type,
            file_name=file_name,
            notes=notes,
        )

    if content_text.strip():
        extracted_text = content_text.strip()
        if multimodal_result.get("extracted_text"):
            extracted_text = "\n".join(part for part in [multimodal_result["extracted_text"], extracted_text] if part).strip()
            ocr_status = multimodal_result.get("ocr_status", "ai_handwriting_interpreted")
            ocr_source = multimodal_result.get("ocr_source", "multimodal_ai_image")
        else:
            ocr_status = "provided_text"
    else:
        plain_text = _extract_plain_text(file_bytes, content_type, header).strip()
        if plain_text:
            extracted_text = plain_text
            ocr_status = "decoded_text_file"
            ocr_source = "text_upload"
        elif multimodal_result.get("extracted_text"):
            extracted_text = multimodal_result["extracted_text"].strip()
            ocr_status = multimodal_result.get("ocr_status", "ai_handwriting_interpreted")
            ocr_source = multimodal_result.get("ocr_source", "multimodal_ai_image")
        elif _looks_like_image(file_name, content_type, header):
            ocr_text = _extract_image_text(file_bytes).strip()
            if ocr_text:
                extracted_text = ocr_text
                ocr_status = "ocr_extracted"
                ocr_source = "image_ocr"
            else:
                extracted_text = ""
                ocr_status = "ocr_unavailable"
                ocr_source = "image_upload"
        else:
            extracted_text = ""
            ocr_status = "no_text_detected"

    combined_text = "\n".join(part for part in [notes.strip(), extracted_text.strip(), file_name.strip()] if part).strip()
    excerpt = extracted_text[:280] if extracted_text else combined_text[:280]
    if _looks_like_image(file_name, content_type, header) and not extracted_text.strip():
        if not _handwriting_ai_available() and not _local_ocr_available():
            ocr_status = "handwriting_ai_unavailable"
            ocr_source = "image_upload"
        elif not _handwriting_ai_available() and _local_ocr_available():
            ocr_status = "ocr_unavailable"
            ocr_source = "image_upload"

    return {
        "combined_text": combined_text,
        "extracted_text": extracted_text,
        "ocr_status": ocr_status,
        "ocr_source": ocr_source,
        "ocr_text_excerpt": excerpt,
        "extraction_model": multimodal_result.get("extraction_model", "ocr-nlp-prescription-v1"),
        "medication_schedule": multimodal_result.get("medication_schedule", []),
        "ai_interpretation_notes": multimodal_result.get("ai_interpretation_notes", ""),
        "document_quality": multimodal_result.get("document_quality", ""),
    }


def _normalize_timing(raw_text: str) -> str:
    lowered = raw_text.lower()
    times: list[str] = []

    for keyword, labels in TIMING_KEYWORDS:
        if keyword in lowered:
            for label in labels:
                if label not in times:
                    times.append(label)

    for keyword, label in [
        ("morning", "Morning"),
        ("noon", "Noon"),
        ("afternoon", "Afternoon"),
        ("evening", "Evening"),
        ("night", "Night"),
    ]:
        if keyword in lowered and label not in times:
            times.append(label)

    qualifiers = []
    if "before food" in lowered or "before meal" in lowered:
        qualifiers.append("Before food")
    if "after food" in lowered or "after meal" in lowered:
        qualifiers.append("After food")
    if "as needed" in lowered or "sos" in lowered or "prn" in lowered:
        qualifiers.append("As needed")

    parts = times + qualifiers
    return ", ".join(parts) if parts else "Follow clinician instructions"


def _extract_duration(raw_text: str) -> str:
    match = DURATION_PATTERN.search(raw_text)
    if not match:
        return "Not specified"
    return match.group(1).replace("for ", "").strip().title()


def _extract_drug_name(raw_text: str) -> str:
    cleaned = MED_NAME_PREFIXES.sub("", raw_text.strip())
    cleaned = re.sub(r"^[\-\u2022\d.)\s]+", "", cleaned)
    tokens = []

    for token in cleaned.split():
        sanitized = token.strip(",.:;()[]")
        lowered = sanitized.lower()
        if not sanitized:
            continue
        if DOSAGE_PATTERN.fullmatch(sanitized):
            break
        if lowered in {"morning", "noon", "afternoon", "evening", "night", "before", "after", "food", "days", "weeks"}:
            break
        if re.fullmatch(r"\d+(?:/\d+)?", sanitized):
            break
        if not re.match(r"^[A-Za-z][A-Za-z0-9/\-]*$", sanitized):
            break
        tokens.append(sanitized)
        if lowered in COMMON_MEDICATION_TOKENS and len(tokens) >= 1:
            break
        if len(tokens) >= 3:
            break

    return " ".join(tokens)


def extract_prescription_entities(
    document_text: str,
    *,
    ai_medication_schedule: Optional[list[dict[str, Any]]] = None,
    ai_interpretation_notes: str = "",
) -> dict[str, Any]:
    lines = [segment.strip(" -") for segment in LINE_SPLIT_PATTERN.split(document_text or "") if segment.strip()]
    medications = _normalize_ai_medication_schedule(ai_medication_schedule)
    seen = {entry["drug_name"].lower() for entry in medications}

    for line in lines:
        drug_name = _extract_drug_name(line)
        if not drug_name:
            continue

        lowered_name = drug_name.lower()
        if lowered_name in seen:
            continue
        seen.add(lowered_name)

        dosage_match = DOSAGE_PATTERN.search(line)
        medications.append(
            {
                "drug_name": drug_name,
                "dosage": dosage_match.group(1) if dosage_match else "Not specified",
                "timing": _normalize_timing(line),
                "duration": _extract_duration(line),
                "source_line": line[:180],
            }
        )

    confidence = 0.25
    if medications and ai_medication_schedule:
        confidence = min(0.98, 0.72 + len(medications) * 0.05)
    elif medications:
        confidence = min(0.94, 0.45 + len(medications) * 0.11)
    elif document_text:
        confidence = 0.38

    return {
        "medication_schedule": medications,
        "extraction_confidence": round(confidence, 2),
        "ai_interpretation_notes": ai_interpretation_notes,
    }


def _to_float(value: str) -> Optional[float]:
    try:
        return float(value)
    except Exception:
        return None


def _unique_preserve(values: list[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for value in values:
        cleaned = " ".join((value or "").split()).strip()
        if not cleaned:
            continue
        lowered = cleaned.lower()
        if lowered in seen:
            continue
        seen.add(lowered)
        result.append(cleaned)
    return result


def _extract_lab_insights(document_text: str) -> dict[str, Any]:
    lowered = (document_text or "").lower()
    structured_findings: list[str] = []
    abnormal_findings: list[str] = []
    follow_up: list[str] = []

    detected_analytes: list[str] = []
    critical_hits = 0
    high_hits = 0

    for analyte, config in LAB_THRESHOLDS.items():
        aliases = config.get("aliases", [analyte])
        match = None
        for alias in aliases:
            pattern = rf"(?:{re.escape(alias)})[^0-9]{{0,24}}(\d+(?:\.\d+)?)"
            match = re.search(pattern, lowered)
            if match:
                break
        if not match:
            continue
        detected_analytes.append(analyte)
        value = _to_float(match.group(1))
        unit = config["unit"]
        label = config["label"]
        structured_findings.append(f"{label}: {match.group(1)} {unit}")
        if value is None:
            continue
        if "critical_low" in config and value <= config["critical_low"]:
            abnormal_findings.append(f"{label} is critically low at {value} {unit}.")
            critical_hits += 1
        elif "low" in config and value < config["low"]:
            abnormal_findings.append(f"{label} is below the expected range at {value} {unit}.")
            high_hits += 1
        elif "critical" in config and value >= config["critical"]:
            abnormal_findings.append(f"{label} is critically elevated at {value} {unit}.")
            critical_hits += 1
        elif "high" in config and value >= config["high"]:
            abnormal_findings.append(f"{label} is above the expected range at {value} {unit}.")
            high_hits += 1

    for keyword in ["abnormal", "positive", "elevated", "reduced", "low", "high"]:
        if keyword in lowered:
            abnormal_findings.append(f"Report text includes the word '{keyword}', suggesting a clinically relevant abnormality.")

    if any("glucose" in finding.lower() or "hba1c" in finding.lower() for finding in abnormal_findings):
        follow_up.append("Review diabetes control and medication adherence with the patient.")
    if any("creatinine" in finding.lower() for finding in abnormal_findings):
        follow_up.append("Renal function should be correlated with medication dosing and hydration status.")
    if any("hemoglobin" in finding.lower() for finding in abnormal_findings):
        follow_up.append("Assess for anemia symptoms and decide whether repeat labs or treatment are needed.")
    if any("troponin" in finding.lower() for finding in abnormal_findings):
        follow_up.append("Correlate troponin elevation with ECG findings and cardiac symptoms immediately.")
    if any("potassium" in finding.lower() or "sodium" in finding.lower() for finding in abnormal_findings):
        follow_up.append("Electrolyte abnormalities should be reviewed against medications, hydration, and cardiac risk.")

    alert_level = "low"
    if critical_hits > 0:
        alert_level = "critical"
    elif high_hits >= 2:
        alert_level = "high"
    elif high_hits == 1 or abnormal_findings:
        alert_level = "medium"

    highlights = _unique_preserve(structured_findings[:4] + abnormal_findings[:3])
    confidence = 0.76 if structured_findings else (0.52 if lowered else 0.0)
    return {
        "document_domain": "lab_report",
        "structured_findings": structured_findings[:6],
        "abnormal_findings": _unique_preserve(abnormal_findings)[:5],
        "clinical_highlights": highlights[:6],
        "follow_up_recommendations": _unique_preserve(follow_up)[:4],
        "lab_alert_level": alert_level,
        "abnormal_value_count": len(_unique_preserve(abnormal_findings)),
        "analytes_detected": detected_analytes[:8],
        "confidence": round(confidence, 2),
    }


def _extract_discharge_insights(document_text: str) -> dict[str, Any]:
    lines = [line.strip(" -") for line in LINE_SPLIT_PATTERN.split(document_text or "") if line.strip()]
    structured_findings: list[str] = []
    abnormal_findings: list[str] = []
    follow_up: list[str] = []
    diagnoses: list[str] = []
    procedures: list[str] = []
    red_flags: list[str] = []
    risk_level = "low"

    for line in lines:
        lowered = line.lower()
        if any(keyword in lowered for keyword in ["diagnosis", "impression", "final diagnosis"]):
            structured_findings.append(f"Diagnosis summary: {line}")
            diagnoses.append(line)
        elif any(keyword in lowered for keyword in ["procedure", "surgery", "operation"]):
            structured_findings.append(f"Procedure summary: {line}")
            procedures.append(line)
        elif any(keyword in lowered for keyword in ["follow up", "review", "return if", "advice"]):
            follow_up.append(line)
        if any(keyword in lowered for keyword in ["return if", "come back if", "seek care if", "warning signs"]):
            red_flags.append(line)
        if any(keyword in lowered for keyword in DISCHARGE_HIGH_RISK_TERMS):
            risk_level = "high"
            abnormal_findings.append(f"Discharge note references a high-risk condition: {line}")
        elif risk_level != "high" and any(keyword in lowered for keyword in DISCHARGE_MODERATE_RISK_TERMS):
            risk_level = "medium"

    if not follow_up and risk_level in {"medium", "high"}:
        follow_up.append("Confirm post-discharge follow-up timing, medication reconciliation, and return precautions.")
    if red_flags:
        follow_up.append("Make sure the patient understands the documented return precautions and red-flag symptoms.")

    highlights = _unique_preserve(structured_findings[:4] + abnormal_findings[:2] + follow_up[:3] + lines[:2])
    return {
        "document_domain": "discharge_note",
        "structured_findings": _unique_preserve(structured_findings)[:6],
        "abnormal_findings": _unique_preserve(abnormal_findings)[:4],
        "clinical_highlights": highlights[:6],
        "follow_up_recommendations": _unique_preserve(follow_up)[:4],
        "discharge_risk_level": risk_level,
        "discharge_risk_summary": (
            "High-risk discharge summary detected. Review diagnosis, return precautions, and follow-up plan carefully."
            if risk_level == "high"
            else "Moderate discharge risk detected. Make sure follow-up and medication instructions are clear."
            if risk_level == "medium"
            else "No high-risk discharge wording was auto-detected."
        ),
        "discharge_key_diagnoses": _unique_preserve(diagnoses)[:4],
        "discharge_procedures": _unique_preserve(procedures)[:4],
        "discharge_red_flags": _unique_preserve(red_flags)[:4],
        "confidence": 0.7 if lines else 0.0,
    }


def _extract_generic_insights(document_text: str, document_type: str) -> dict[str, Any]:
    lines = [line.strip(" -") for line in LINE_SPLIT_PATTERN.split(document_text or "") if line.strip()]
    highlights = _unique_preserve(lines[:5])
    return {
        "document_domain": document_type or "other",
        "structured_findings": highlights[:4],
        "abnormal_findings": [],
        "clinical_highlights": highlights[:6],
        "follow_up_recommendations": [],
        "confidence": 0.45 if lines else 0.0,
    }


def extract_clinical_document_entities(
    *,
    document_type: str,
    document_text: str,
    ai_medication_schedule: Optional[list[dict[str, Any]]] = None,
    ai_interpretation_notes: str = "",
) -> dict[str, Any]:
    normalized_type = (document_type or "other").strip().lower()

    if normalized_type == "prescription":
        prescription = extract_prescription_entities(
            document_text,
            ai_medication_schedule=ai_medication_schedule,
            ai_interpretation_notes=ai_interpretation_notes,
        )
        medication_names = [entry["drug_name"] for entry in prescription["medication_schedule"] if entry.get("drug_name")]
        return {
            "document_domain": "prescription",
            "structured_findings": medication_names[:6],
            "abnormal_findings": [],
            "clinical_highlights": medication_names[:6],
            "follow_up_recommendations": (
                ["Confirm drug dose, timing, and allergies with the patient before discharge."]
                if prescription["medication_schedule"]
                else []
            ),
            "lab_alert_level": "low",
            "abnormal_value_count": 0,
            "analytes_detected": [],
            "discharge_risk_level": "low",
            "discharge_risk_summary": "",
            "discharge_key_diagnoses": [],
            "discharge_procedures": [],
            "discharge_red_flags": [],
            "medication_schedule": prescription["medication_schedule"],
            "extraction_confidence": prescription["extraction_confidence"],
            "ai_interpretation_notes": prescription["ai_interpretation_notes"],
        }

    if normalized_type == "lab_report":
        insights = _extract_lab_insights(document_text)
        return {
            **insights,
            "medication_schedule": [],
            "extraction_confidence": insights["confidence"],
            "ai_interpretation_notes": ai_interpretation_notes,
        }

    if normalized_type == "discharge_note":
        insights = _extract_discharge_insights(document_text)
        return {
            **insights,
            "medication_schedule": [],
            "extraction_confidence": insights["confidence"],
            "ai_interpretation_notes": ai_interpretation_notes,
        }

    insights = _extract_generic_insights(document_text, normalized_type)
    return {
        **insights,
        "lab_alert_level": "low",
        "abnormal_value_count": 0,
        "analytes_detected": [],
        "discharge_risk_level": "low",
        "discharge_risk_summary": "",
        "discharge_key_diagnoses": [],
        "discharge_procedures": [],
        "discharge_red_flags": [],
        "medication_schedule": [],
        "extraction_confidence": insights["confidence"],
        "ai_interpretation_notes": ai_interpretation_notes,
    }
