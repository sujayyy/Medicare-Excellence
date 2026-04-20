import hashlib
import math
import os
import re
from functools import lru_cache
from typing import Any, Optional

from flask import current_app

try:
    import google.generativeai as genai
except Exception:  # pragma: no cover - optional dependency
    genai = None

from models.patient_memory_model import create_patient_memory, list_patient_memories


EMBEDDING_DIMENSIONS = 128
MIN_MEMORY_CHARACTERS = 18

STOP_WORDS = {
    "a",
    "an",
    "and",
    "are",
    "as",
    "at",
    "be",
    "but",
    "by",
    "for",
    "from",
    "had",
    "has",
    "have",
    "i",
    "in",
    "is",
    "it",
    "me",
    "my",
    "of",
    "on",
    "or",
    "the",
    "to",
    "was",
    "with",
    "you",
}

MEDICAL_SYNONYMS = {
    "breathlessness": "shortness breath",
    "breathing": "shortness breath",
    "bp": "blood pressure",
    "hypertension": "blood pressure",
    "sugar": "glucose diabetes",
    "diabetic": "glucose diabetes",
    "migraine": "headache neuro",
    "dizzy": "dizziness",
    "dizziness": "dizzy vertigo",
    "cardiac": "heart chest",
    "palpitation": "heart beat",
    "palpitations": "heart beat",
    "feverish": "fever",
}

TRANSFORMER_MODEL = "models/text-embedding-004"
TRANSFORMER_TEXT_LIMIT = 6000


def _tokenize(text: str) -> list[str]:
    expanded = text.lower()
    for source, replacement in MEDICAL_SYNONYMS.items():
        expanded = expanded.replace(source, f"{source} {replacement}")

    tokens = re.findall(r"[a-z0-9]+", expanded)
    return [token for token in tokens if len(token) > 1 and token not in STOP_WORDS]


def _hash_bucket(token: str) -> tuple[int, float]:
    digest = hashlib.sha256(token.encode("utf-8")).digest()
    bucket = int.from_bytes(digest[:4], "big") % EMBEDDING_DIMENSIONS
    sign = 1.0 if digest[4] % 2 == 0 else -1.0
    return bucket, sign


def _weighted_text(
    text: str,
    *,
    entities: Optional[dict[str, Any]] = None,
    triage: Optional[dict[str, Any]] = None,
) -> str:
    weighted_text_parts = [text or ""]
    entities = entities or {}
    triage = triage or {}

    for symptom in entities.get("symptoms") or []:
        weighted_text_parts.extend([str(symptom)] * 4)
    for body_part in entities.get("body_parts") or []:
        weighted_text_parts.extend([str(body_part)] * 2)
    for red_flag in entities.get("red_flags") or []:
        weighted_text_parts.extend([str(red_flag)] * 5)
    if entities.get("duration_text"):
        weighted_text_parts.append(str(entities["duration_text"]))
    if triage.get("triage_label"):
        weighted_text_parts.extend([str(triage["triage_label"])] * 2)
    if triage.get("recommended_action"):
        weighted_text_parts.append(str(triage["recommended_action"]))

    return " ".join(weighted_text_parts)


def _build_hash_embedding(weighted_text: str) -> list[float]:
    vector = [0.0] * EMBEDDING_DIMENSIONS
    for token in _tokenize(weighted_text):
        bucket, sign = _hash_bucket(token)
        vector[bucket] += sign

    norm = math.sqrt(sum(value * value for value in vector))
    if not norm:
        return vector
    return [round(value / norm, 6) for value in vector]


def _transformer_available() -> bool:
    return bool(os.getenv("GEMINI_API_KEY") and genai is not None)


def _extract_embedding_values(response: Any) -> list[float]:
    if isinstance(response, dict):
        values = response.get("embedding") or response.get("embedding_values") or []
    else:
        values = getattr(response, "embedding", None) or getattr(response, "values", None) or []
    if not isinstance(values, list):
        return []
    return [float(value) for value in values]


@lru_cache(maxsize=512)
def _build_transformer_embedding_cached(weighted_text: str, task_type: str) -> tuple[float, ...]:
    if not _transformer_available():
        return tuple()

    try:
        genai.configure(api_key=os.getenv("GEMINI_API_KEY"))
        response = genai.embed_content(
            model=TRANSFORMER_MODEL,
            content=weighted_text[:TRANSFORMER_TEXT_LIMIT],
            task_type=task_type,
        )
        values = _extract_embedding_values(response)
        return tuple(round(value, 6) for value in values)
    except Exception:
        return tuple()


def build_semantic_embedding_profile(
    text: str,
    *,
    entities: Optional[dict[str, Any]] = None,
    triage: Optional[dict[str, Any]] = None,
    task_type: str = "retrieval_document",
) -> dict[str, Any]:
    weighted_text = _weighted_text(text, entities=entities, triage=triage)
    fallback_embedding = _build_hash_embedding(weighted_text)
    transformer_embedding = list(_build_transformer_embedding_cached(weighted_text, task_type))

    if transformer_embedding:
        return {
            "embedding": transformer_embedding,
            "model": "gemini-text-embedding-004",
            "dimensions": len(transformer_embedding),
            "strategy": "transformer",
            "fallback_embedding": fallback_embedding,
            "fallback_model": "hashing-vectorizer-medical-v1",
            "fallback_dimensions": EMBEDDING_DIMENSIONS,
        }

    return {
        "embedding": fallback_embedding,
        "model": "hashing-vectorizer-medical-v1",
        "dimensions": EMBEDDING_DIMENSIONS,
        "strategy": "hash",
        "fallback_embedding": [],
        "fallback_model": "",
        "fallback_dimensions": 0,
    }


def build_semantic_embedding(
    text: str,
    *,
    entities: Optional[dict[str, Any]] = None,
    triage: Optional[dict[str, Any]] = None,
    task_type: str = "retrieval_document",
) -> list[float]:
    return build_semantic_embedding_profile(
        text,
        entities=entities,
        triage=triage,
        task_type=task_type,
    )["embedding"]


def _cosine_similarity(left: list[float], right: list[float]) -> float:
    if not left or not right or len(left) != len(right):
        return 0.0
    return sum(a * b for a, b in zip(left, right))


def semantic_similarity(
    left_text: str,
    right_text: str,
    *,
    left_entities: Optional[dict[str, Any]] = None,
    left_triage: Optional[dict[str, Any]] = None,
    right_entities: Optional[dict[str, Any]] = None,
    right_triage: Optional[dict[str, Any]] = None,
) -> float:
    left_profile = build_semantic_embedding_profile(
        left_text,
        entities=left_entities,
        triage=left_triage,
        task_type="retrieval_query",
    )
    right_profile = build_semantic_embedding_profile(
        right_text,
        entities=right_entities,
        triage=right_triage,
        task_type="retrieval_document",
    )

    return semantic_similarity_from_profiles(left_profile, right_profile, left_text=left_text, right_text=right_text, left_entities=left_entities, left_triage=left_triage, right_entities=right_entities, right_triage=right_triage)


def semantic_similarity_from_profiles(
    left_profile: dict[str, Any],
    right_profile: dict[str, Any],
    *,
    left_text: str,
    right_text: str,
    left_entities: Optional[dict[str, Any]] = None,
    left_triage: Optional[dict[str, Any]] = None,
    right_entities: Optional[dict[str, Any]] = None,
    right_triage: Optional[dict[str, Any]] = None,
) -> float:

    primary_score = _cosine_similarity(left_profile["embedding"], right_profile["embedding"])
    fallback_score = _cosine_similarity(
        left_profile.get("fallback_embedding") or _build_hash_embedding(_weighted_text(left_text, entities=left_entities, triage=left_triage)),
        right_profile.get("fallback_embedding") or _build_hash_embedding(_weighted_text(right_text, entities=right_entities, triage=right_triage)),
    )
    return max(primary_score, fallback_score)


def _format_memory_content(
    user_message: str,
    assistant_message: str,
    *,
    entities: Optional[dict[str, Any]] = None,
    triage: Optional[dict[str, Any]] = None,
) -> str:
    entities = entities or {}
    triage = triage or {}
    symptoms = ", ".join((entities.get("symptoms") or [])[:5]) or "not extracted"
    red_flags = ", ".join((entities.get("red_flags") or [])[:4]) or "none"
    triage_label = triage.get("triage_label") or "Unknown"
    triage_score = triage.get("triage_score", 0)

    return (
        f"Patient message: {user_message}\n"
        f"Symptoms: {symptoms}\n"
        f"Red flags: {red_flags}\n"
        f"Triage: {triage_label} ({triage_score}/100)\n"
        f"Assistant response: {assistant_message[:300]}"
    )


def store_chat_memory(
    user: Optional[dict[str, Any]],
    user_message: str,
    assistant_message: str,
    *,
    triage: Optional[dict[str, Any]] = None,
    entities: Optional[dict[str, Any]] = None,
) -> None:
    if not user or user.get("role") != "patient":
        return

    if len((user_message or "").strip()) < MIN_MEMORY_CHARACTERS and not (entities or {}).get("symptoms"):
        return

    content = _format_memory_content(user_message, assistant_message, entities=entities, triage=triage)
    embedding_profile = build_semantic_embedding_profile(
        content,
        entities=entities,
        triage=triage,
        task_type="retrieval_document",
    )

    try:
        create_patient_memory(
            {
                "user_id": user["id"],
                "user_name": user.get("name", ""),
                "user_email": user.get("email", ""),
                "hospital_id": user.get("hospital_id"),
                "source": "chat",
                "content": content,
                "raw_user_message": user_message,
                "assistant_message_preview": assistant_message[:300],
                "embedding_model": embedding_profile["model"],
                "embedding_dimensions": embedding_profile["dimensions"],
                "embedding_strategy": embedding_profile["strategy"],
                "embedding": embedding_profile["embedding"],
                "fallback_embedding_model": embedding_profile.get("fallback_model", ""),
                "fallback_embedding_dimensions": embedding_profile.get("fallback_dimensions", 0),
                "fallback_embedding": embedding_profile.get("fallback_embedding", []),
                "triage_label": (triage or {}).get("triage_label"),
                "triage_score": (triage or {}).get("triage_score"),
                "symptoms": (entities or {}).get("symptoms", []),
                "red_flags": (entities or {}).get("red_flags", []),
            }
        )
    except Exception as exc:  # pragma: no cover - defensive runtime fallback
        current_app.logger.exception("Unable to store patient memory: %s", exc)


def retrieve_patient_memories(
    user: Optional[dict[str, Any]],
    query: str,
    *,
    entities: Optional[dict[str, Any]] = None,
    triage: Optional[dict[str, Any]] = None,
    limit: int = 3,
) -> dict[str, Any]:
    if not user or user.get("role") != "patient":
        return {"items": [], "summary": "", "model": "hashing-vectorizer-medical-v1"}

    query_profile = build_semantic_embedding_profile(
        query,
        entities=entities,
        triage=triage,
        task_type="retrieval_query",
    )
    memories = list_patient_memories(user["id"], limit=80)
    scored_memories: list[dict[str, Any]] = []

    for memory in memories:
        primary_score = _cosine_similarity(query_profile["embedding"], memory.get("embedding") or [])
        fallback_score = _cosine_similarity(
            query_profile.get("fallback_embedding") or [],
            memory.get("fallback_embedding") or (
                memory.get("embedding") if (memory.get("embedding_model") or "").startswith("hashing-vectorizer") else []
            ),
        )
        score = max(primary_score, fallback_score)
        if score <= 0.08:
            continue
        scored_memories.append({**memory, "similarity": round(score, 4)})

    top_memories = sorted(scored_memories, key=lambda item: item["similarity"], reverse=True)[:limit]
    summary_lines = []
    for memory in top_memories:
        symptoms = ", ".join((memory.get("symptoms") or [])[:4]) or "general concern"
        triage_label = memory.get("triage_label") or "Unknown"
        summary_lines.append(
            f"- Prior related concern: {symptoms}; previous triage: {triage_label}; "
            f"message: {memory.get('raw_user_message', '')[:120]}"
        )

    return {
        "items": top_memories,
        "summary": "\n".join(summary_lines),
        "model": query_profile["model"],
    }
