from typing import Any, Optional

from services.memory_service import build_semantic_embedding_profile, semantic_similarity_from_profiles


SPECIALTY_LABELS = {
    "general_medicine": "General Medicine",
    "cardiology": "Cardiology",
    "pulmonology": "Pulmonology",
    "neurology": "Neurology",
    "endocrinology": "Endocrinology",
    "dermatology": "Dermatology",
    "orthopedics": "Orthopedics",
    "pediatrics": "Pediatrics",
    "psychiatry": "Psychiatry",
    "ent": "ENT",
    "gynecology": "Gynecology",
    "gastroenterology": "Gastroenterology",
    "nephrology": "Nephrology",
    "oncology": "Oncology",
    "ophthalmology": "Ophthalmology",
}


SPECIALTY_PROFILES = {
    "cardiology": {
        "keywords": [
            "chest pain",
            "heart",
            "cardiac",
            "palpitation",
            "palpitations",
            "blood pressure",
            "hypertension",
            "left arm pain",
            "sweating",
        ],
        "red_flags": ["chest pain", "shortness of breath", "fainting"],
        "prototype": "heart chest pain cardiac symptoms palpitations blood pressure left arm sweating emergency",
    },
    "pulmonology": {
        "keywords": [
            "shortness of breath",
            "difficulty breathing",
            "breathing",
            "asthma",
            "wheezing",
            "cough",
            "lung",
            "oxygen",
            "chest tightness",
        ],
        "red_flags": ["shortness of breath", "difficulty breathing"],
        "prototype": "lungs breathing cough wheezing asthma oxygen respiratory shortness breath chest tightness",
    },
    "neurology": {
        "keywords": [
            "headache",
            "migraine",
            "dizziness",
            "vertigo",
            "seizure",
            "stroke",
            "numbness",
            "tingling",
            "blurred vision",
            "weakness",
        ],
        "red_flags": ["seizure", "stroke", "numbness"],
        "prototype": "brain headache migraine dizziness vertigo seizure numbness tingling blurred vision weakness neuro",
    },
    "endocrinology": {
        "keywords": [
            "glucose",
            "diabetes",
            "sugar",
            "thyroid",
            "insulin",
            "hormone",
            "weight gain",
            "weight loss",
            "fatigue",
        ],
        "red_flags": [],
        "prototype": "diabetes thyroid hormone insulin glucose sugar endocrine fatigue metabolism",
    },
    "dermatology": {
        "keywords": [
            "rash",
            "itching",
            "skin",
            "acne",
            "eczema",
            "psoriasis",
            "allergy",
            "red patch",
        ],
        "red_flags": [],
        "prototype": "skin rash itching allergy acne eczema dermatology red patch irritation",
    },
    "orthopedics": {
        "keywords": [
            "back pain",
            "knee pain",
            "joint pain",
            "shoulder pain",
            "fracture",
            "bone",
            "arm pain",
            "leg pain",
            "neck pain",
        ],
        "red_flags": [],
        "prototype": "bone joint back pain orthopedic fracture leg arm shoulder knee neck muscle",
    },
    "pediatrics": {
        "keywords": [
            "child",
            "kid",
            "baby",
            "infant",
            "newborn",
            "pediatric",
            "child fever",
        ],
        "red_flags": ["infant", "newborn"],
        "prototype": "child baby infant pediatric fever cough growth vaccination newborn",
    },
    "psychiatry": {
        "keywords": [
            "anxiety",
            "anxious",
            "panic",
            "depression",
            "stress",
            "sleep",
            "insomnia",
            "mood",
            "suicidal",
        ],
        "red_flags": ["suicidal"],
        "prototype": "mental health anxiety depression panic sleep stress mood psychiatry",
    },
    "ent": {
        "keywords": [
            "sore throat",
            "ear pain",
            "ear infection",
            "sinus",
            "nose",
            "hearing",
            "tonsil",
            "throat",
        ],
        "red_flags": [],
        "prototype": "ear nose throat sinus sore throat hearing ent tonsil infection",
    },
    "gynecology": {
        "keywords": [
            "pregnancy",
            "period",
            "menstrual",
            "vaginal",
            "pelvic pain",
            "pcos",
            "gyne",
            "uterus",
        ],
        "red_flags": ["heavy bleeding"],
        "prototype": "pregnancy gynecology period menstrual pelvic pain pcos bleeding uterus",
    },
    "gastroenterology": {
        "keywords": [
            "abdominal pain",
            "stomach",
            "abdomen",
            "vomiting",
            "nausea",
            "diarrhea",
            "constipation",
            "acidity",
            "reflux",
            "liver",
        ],
        "red_flags": ["blood in vomit"],
        "prototype": "stomach abdominal pain vomiting nausea diarrhea constipation acidity reflux gastro liver",
    },
    "nephrology": {
        "keywords": [
            "kidney",
            "urine",
            "creatinine",
            "swelling",
            "blood in urine",
            "dialysis",
            "water retention",
        ],
        "red_flags": ["blood in urine"],
        "prototype": "kidney urine creatinine swelling dialysis nephrology fluid blood urine",
    },
    "oncology": {
        "keywords": [
            "tumor",
            "cancer",
            "chemotherapy",
            "radiation",
            "mass",
            "oncology",
        ],
        "red_flags": [],
        "prototype": "cancer tumor oncology chemotherapy radiation mass malignant",
    },
    "ophthalmology": {
        "keywords": [
            "eye pain",
            "blurred vision",
            "vision",
            "red eye",
            "watering eyes",
            "eye infection",
            "sight",
        ],
        "red_flags": ["blurred vision"],
        "prototype": "eye blurred vision red eye sight watering ophthalmology infection",
    },
}


def get_specialty_label(specialty: Optional[str]) -> str:
    normalized = (specialty or "general_medicine").strip().lower()
    return SPECIALTY_LABELS.get(normalized, "General Medicine")

def _build_haystack(user_message: str, entities: Optional[dict[str, Any]]) -> str:
    entities = entities or {}
    return " ".join(
        [
            user_message or "",
            " ".join(entities.get("symptoms") or []),
            " ".join(entities.get("red_flags") or []),
            " ".join(entities.get("body_parts") or []),
            " ".join(entities.get("medications_mentioned") or []),
            entities.get("duration_text") or "",
        ]
    ).lower()


def _specialty_bonus(specialty: str, haystack: str) -> int:
    if specialty == "neurology" and "headache" in haystack:
        bonus = 18
        if "blurred vision" in haystack or "dizziness" in haystack or "vertigo" in haystack:
            bonus += 10
        return bonus

    if specialty == "cardiology" and "chest pain" in haystack:
        bonus = 18
        if "left arm" in haystack or "sweating" in haystack or "shortness of breath" in haystack:
            bonus += 10
        return bonus

    if specialty == "psychiatry" and ("anxiety" in haystack or "anxious" in haystack or "panic" in haystack):
        bonus = 16
        if "sleep" in haystack or "insomnia" in haystack or "stress" in haystack:
            bonus += 8
        return bonus

    if specialty == "gastroenterology" and ("abdominal pain" in haystack or "vomiting" in haystack):
        return 16

    if specialty == "dermatology" and ("rash" in haystack or "itching" in haystack or "skin" in haystack):
        return 16

    return 0


def rank_specialties(*, user_message: str = "", entities: Optional[dict[str, Any]] = None) -> list[dict[str, Any]]:
    haystack = _build_haystack(user_message, entities)
    entities = entities or {}
    query_profile = build_semantic_embedding_profile(
        haystack,
        entities=entities,
        task_type="retrieval_query",
    )
    rankings: list[dict[str, Any]] = []

    for specialty, profile in SPECIALTY_PROFILES.items():
        keyword_hits = [keyword for keyword in profile["keywords"] if keyword in haystack]
        red_flag_hits = [flag for flag in profile["red_flags"] if flag in haystack]
        prototype_profile = build_semantic_embedding_profile(
            profile["prototype"],
            task_type="retrieval_document",
        )
        similarity_score = semantic_similarity_from_profiles(
            query_profile,
            prototype_profile,
            left_text=haystack,
            right_text=profile["prototype"],
            left_entities=entities,
        )
        score = (
            len(keyword_hits) * 16
            + len(red_flag_hits) * 20
            + round(max(similarity_score, 0) * 100)
            + _specialty_bonus(specialty, haystack)
        )

        rankings.append(
            {
                "specialty": specialty,
                "label": get_specialty_label(specialty),
                "score": score,
                "keyword_hits": keyword_hits[:4],
                "red_flag_hits": red_flag_hits[:3],
                "semantic_similarity": round(similarity_score, 4),
                "confidence": round(min(0.98, 0.42 + (max(score, 0) / 180)), 2),
                "model": "transformer-semantic-specialty-v3",
                "reason": _build_specialty_reason(
                    specialty,
                    keyword_hits=keyword_hits,
                    red_flag_hits=red_flag_hits,
                    semantic_similarity=similarity_score,
                ),
            }
        )

    rankings.sort(key=lambda item: (item["score"], item["semantic_similarity"]), reverse=True)
    return rankings


def _build_specialty_reason(
    specialty: str,
    *,
    keyword_hits: list[str],
    red_flag_hits: list[str],
    semantic_similarity: float,
) -> str:
    label = get_specialty_label(specialty)
    if keyword_hits:
        return f"{label} matched symptoms like {', '.join(keyword_hits[:3])}."
    if red_flag_hits:
        return f"{label} matched red-flag findings like {', '.join(red_flag_hits[:2])}."
    if semantic_similarity > 0.12:
        return f"{label} was selected through semantic symptom similarity."
    return f"{label} is the safest fallback specialty."


def infer_specialty(*, user_message: str = "", entities: Optional[dict[str, Any]] = None) -> str:
    rankings = rank_specialties(user_message=user_message, entities=entities)
    if not rankings:
        return "general_medicine"

    best = rankings[0]
    if best["score"] < 18:
        return "general_medicine"
    return best["specialty"]


def get_specialty_match(*, user_message: str = "", entities: Optional[dict[str, Any]] = None) -> dict[str, Any]:
    rankings = rank_specialties(user_message=user_message, entities=entities)
    if not rankings:
        return {
            "specialty": "general_medicine",
            "label": "General Medicine",
            "score": 0,
            "reason": "General Medicine is the fallback specialty.",
            "model": "transformer-semantic-specialty-v3",
            "confidence": 0.4,
            "alternatives": [],
        }

    best = rankings[0]
    if best["score"] < 18:
        return {
            "specialty": "general_medicine",
            "label": "General Medicine",
            "score": best["score"],
            "reason": "General Medicine is the fallback specialty because the symptom pattern is broad.",
            "model": "transformer-semantic-specialty-v3",
            "confidence": best.get("confidence", 0.45),
            "alternatives": rankings[:3],
        }

    return {
        **best,
        "alternatives": rankings[1:4],
    }
