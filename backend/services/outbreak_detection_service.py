from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from typing import Any, Optional


CLUSTER_RULES: dict[str, list[str]] = {
    "Respiratory": ["cough", "shortness of breath", "breath", "wheezing", "throat", "cold", "flu", "congestion"],
    "Cardiac": ["chest pain", "palpitation", "heart", "left arm pain", "sweating", "cardiac"],
    "Neurology": ["headache", "migraine", "dizziness", "seizure", "vision", "fainting", "numbness"],
    "Gastrointestinal": ["abdominal pain", "stomach", "vomiting", "nausea", "diarrhea", "constipation", "gastric"],
    "Fever/Infection": ["fever", "chills", "infection", "viral", "body ache", "fatigue"],
    "Dermatology": ["rash", "itching", "skin", "allergy", "hives"],
    "Mental Health": ["anxiety", "panic", "stress", "depression", "sleep", "insomnia"],
    "Musculoskeletal": ["joint pain", "back pain", "knee", "shoulder", "fracture", "muscle"],
}


def _parse_datetime(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


def _classify_cluster(text: str) -> tuple[str, list[str]]:
    lowered = (text or "").lower()
    matches: list[tuple[str, str]] = []
    for cluster, keywords in CLUSTER_RULES.items():
        for keyword in keywords:
            if keyword in lowered:
                matches.append((cluster, keyword))

    if not matches:
        return "General", []

    cluster_scores = Counter(cluster for cluster, _ in matches)
    top_cluster = cluster_scores.most_common(1)[0][0]
    related_terms = []
    for cluster, keyword in matches:
        if cluster == top_cluster and keyword not in related_terms:
            related_terms.append(keyword)
    return top_cluster, related_terms[:4]


def _daily_key(value: datetime) -> str:
    return value.astimezone(timezone.utc).strftime("%b %d")


def build_outbreak_signals(
    *,
    patients: list[dict[str, Any]],
    emergencies: list[dict[str, Any]],
    now: Optional[datetime] = None,
) -> dict[str, Any]:
    now = now or datetime.now(timezone.utc)
    recent_threshold = now - timedelta(hours=72)
    baseline_threshold = now - timedelta(days=14)
    recent_daily_threshold = now - timedelta(days=7)

    recent_cluster_counts: Counter[str] = Counter()
    baseline_cluster_counts: Counter[str] = Counter()
    recent_cluster_terms: dict[str, Counter[str]] = defaultdict(Counter)
    outbreak_timeline: dict[str, Counter[str]] = defaultdict(Counter)

    def process_signal(text: str, timestamp: Optional[datetime]) -> None:
        if not text or not timestamp or timestamp < baseline_threshold:
            return

        cluster, terms = _classify_cluster(text)
        if cluster == "General":
            return

        if timestamp >= recent_threshold:
            recent_cluster_counts.update([cluster])
            recent_cluster_terms[cluster].update(terms)
        else:
            baseline_cluster_counts.update([cluster])

        if timestamp >= recent_daily_threshold:
            outbreak_timeline[_daily_key(timestamp)].update([cluster])

    for patient in patients:
        timestamp = _parse_datetime(patient.get("updated_at") or patient.get("created_at"))
        symptom_text = ", ".join(patient.get("symptoms") or [])
        process_signal(symptom_text, timestamp)

    for emergency in emergencies:
        timestamp = _parse_datetime(emergency.get("created_at") or emergency.get("updated_at"))
        process_signal(emergency.get("message") or "", timestamp)

    outbreak_clusters = []
    for cluster, recent_count in recent_cluster_counts.most_common():
        baseline_count = baseline_cluster_counts.get(cluster, 0)
        baseline_daily_avg = round(baseline_count / 11, 2) if baseline_count else 0.0
        anomaly_score = round((recent_count * 1.8) + max(0, recent_count - baseline_daily_avg), 2)

        if recent_count < 2 and anomaly_score < 3:
            continue

        severity = "high" if recent_count >= 4 or anomaly_score >= 6 else "medium" if recent_count >= 2 else "low"
        top_terms = [term for term, _ in recent_cluster_terms[cluster].most_common(3)]
        outbreak_clusters.append(
            {
                "cluster": cluster,
                "recent_count": recent_count,
                "baseline_daily_avg": baseline_daily_avg,
                "anomaly_score": anomaly_score,
                "severity": severity,
                "top_symptoms": top_terms,
                "summary": f"{cluster} complaints are rising above the recent baseline and should be watched by hospital operations.",
            }
        )

    sorted_days = sorted(outbreak_timeline.keys(), key=lambda day: datetime.strptime(day, "%b %d"))
    outbreak_timeline_points = []
    for day in sorted_days:
        row: dict[str, Any] = {"day": day}
        for cluster, count in outbreak_timeline[day].items():
            row[cluster] = count
        outbreak_timeline_points.append(row)

    return {
        "outbreak_clusters": outbreak_clusters[:5],
        "outbreak_timeline": outbreak_timeline_points,
    }
