"""
services/analyzer.py

Core analysis engine for the FactShield AI Auditor.
Heuristically evaluates text claims for hallucinations, bias,
emotional manipulation, unverified statistics, and fact-checking signals.
"""

import re

# ---------------------------------------------------------------------------
# Keyword dictionaries for heuristic analysis
# ---------------------------------------------------------------------------

ABSOLUTE_CLAIM_WORDS = {
    "always", "never", "everyone", "nobody", "all", "none",
    "every", "impossible", "guaranteed", "proven", "definitive",
    "certain", "absolutely", "undeniably", "unquestionably",
    "without doubt", "100%", "perfect", "flawless", "infallible",
    "inevitable", "invariably", "unconditionally",
}

EMOTIONAL_TRIGGER_WORDS = {
    "shocking", "outrageous", "horrifying", "unbelievable", "incredible",
    "terrifying", "devastating", "explosive", "scandalous", "alarming",
    "catastrophic", "disastrous", "urgent", "crisis", "danger",
    "miracle", "revolutionary", "secret", "exposed", "conspiracy",
    "warning", "must-see", "breaking", "exclusive", "bombshell",
}

BIAS_INDICATOR_WORDS = {
    "obviously", "clearly", "everyone knows", "it's obvious",
    "of course", "naturally", "simply", "just", "merely",
    "only", "radical", "extreme", "agenda", "propaganda",
    "brainwashed", "naive", "foolish", "ridiculous",
}

HALLUCINATION_WORDS = {
    "scientists say", "experts agree", "studies show", "research proves",
    "it is known", "it is a fact", "undisputed", "universally accepted",
    "according to science", "doctors confirm", "governments admit",
}

# Regex patterns
STAT_PATTERN = re.compile(
    r"""
    \b\d+(?:\.\d+)?%          # percentage like 45% or 3.5%
    |\b\d{1,3}(?:,\d{3})+\b  # large numbers like 1,000,000
    |\b\d+\s*(?:million|billion|trillion|thousand)\b  # written-out numbers
    |\b(?:study|studies|research|survey|poll|data|statistics?)\s+
      (?:show(?:s|ed)?|found|reveal(?:s|ed)?|indicate(?:s|d)?|suggest(?:s|ed)?) # study shows
    """,
    re.IGNORECASE | re.VERBOSE,
)

CITATION_PATTERN = re.compile(
    r"""
    \b(?:according\s+to|source[s]?:|cited\s+by|published\s+in|
        as\s+reported\s+by|researchers?\s+at|scientists?\s+at|
        university\s+of|journal\s+of|doi:|arxiv:|pubmed:)
    """,
    re.IGNORECASE | re.VERBOSE,
)

FACT_CHECK_POSITIVE = re.compile(
    r"\b(?:confirmed|verified|true|correct|accurate|validated|authenticated|established)\b",
    re.IGNORECASE,
)

FACT_CHECK_NEGATIVE = re.compile(
    r"\b(?:false|incorrect|debunked|misleading|inaccurate|disputed|disproven|unfounded)\b",
    re.IGNORECASE,
)


# ---------------------------------------------------------------------------
# Helper functions
# ---------------------------------------------------------------------------

def _tokenize_lower(text: str) -> set:
    """Return a set of lowercase words from the text."""
    return set(re.findall(r"[a-z']+", text.lower()))


def _count_emotional_words(tokens: set) -> int:
    return len(tokens & EMOTIONAL_TRIGGER_WORDS)


def _count_bias_words(tokens: set) -> int:
    return len(tokens & BIAS_INDICATOR_WORDS)


def _has_absolute_claim(tokens: set, raw: str) -> bool:
    if tokens & ABSOLUTE_CLAIM_WORDS:
        return True
    raw_lower = raw.lower()
    for phrase in ["without doubt", "everyone knows", "it's obvious", "of course"]:
        if phrase in raw_lower:
            return True
    return False


def _has_hallucination_phrase(raw: str) -> bool:
    raw_lower = raw.lower()
    for phrase in HALLUCINATION_WORDS:
        if phrase in raw_lower:
            return True
    return False


def _has_stat(text: str) -> bool:
    return bool(STAT_PATTERN.search(text))


def _has_citation(text: str) -> bool:
    return bool(CITATION_PATTERN.search(text))


def _fact_check_signal(text: str) -> str:
    """Return 'positive', 'negative', or 'neutral' based on fact-check language."""
    if FACT_CHECK_NEGATIVE.search(text):
        return "negative"
    if FACT_CHECK_POSITIVE.search(text) or _has_citation(text):
        return "positive"
    return "neutral"


def _sentence_confidence(claim: str) -> float:
    """Return a 0.0–1.0 confidence score for an individual claim."""
    tokens = _tokenize_lower(claim)
    score = 0.75  # neutral baseline

    # Penalties
    if _has_absolute_claim(tokens, claim):
        score -= 0.30
    if _count_emotional_words(tokens) > 0:
        score -= 0.10 * min(_count_emotional_words(tokens), 3)
    if _count_bias_words(tokens) > 0:
        score -= 0.08 * min(_count_bias_words(tokens), 3)
    if _has_stat(claim) and not _has_citation(claim):
        score -= 0.20
    if _has_hallucination_phrase(claim):
        score -= 0.15

    # Bonuses
    if _has_citation(claim):
        score += 0.20
    if FACT_CHECK_POSITIVE.search(claim):
        score += 0.05
    if len(claim.split()) >= 12:
        score += 0.05

    return round(max(0.0, min(1.0, score)), 2)


def _classify_claim(claim: str, confidence: float) -> tuple:
    """
    Return (status, reason, flags) based on claim content and confidence.
    flags is a list of detection categories that fired on this claim.
    """
    tokens = _tokenize_lower(claim)
    has_abs = _has_absolute_claim(tokens, claim)
    has_stat = _has_stat(claim)
    has_cite = _has_citation(claim)
    emo_count = _count_emotional_words(tokens)
    bias_count = _count_bias_words(tokens)
    has_hallucination = _has_hallucination_phrase(claim)
    fact_signal = _fact_check_signal(claim)

    reasons = []
    flags = []

    # ── Hallucination check
    if has_abs:
        reasons.append("Contains absolute language that may signal a hallucinated claim.")
        flags.append("hallucination")
    if has_hallucination:
        reasons.append("Uses vague authority references typical of hallucinated content.")
        if "hallucination" not in flags:
            flags.append("hallucination")

    # ── Statistics check
    if has_stat and not has_cite:
        reasons.append("Statistical claim without a verifiable source citation.")
        flags.append("unverified_stat")

    # ── Emotional manipulation check
    if emo_count > 0:
        reasons.append(f"Uses {emo_count} emotionally charged word(s) that may manipulate perception.")
        flags.append("emotional")

    # ── Bias check
    if bias_count > 0:
        reasons.append(f"Contains {bias_count} bias indicator(s) suggesting one-sided framing.")
        flags.append("bias")

    # ── Fact-check signals
    if fact_signal == "positive":
        reasons.append("Includes credible citation or verified language — adds trustworthiness.")
        flags.append("fact_verified")
    elif fact_signal == "negative":
        reasons.append("Contains language indicating a debunked or false claim.")
        flags.append("fact_debunked")

    # ── Determine overall status
    if has_abs or has_hallucination or fact_signal == "negative":
        status = "Flagged"
    elif has_stat and not has_cite:
        status = "Unverified"
    elif confidence >= 0.70:
        status = "Verified"
    elif confidence >= 0.45:
        status = "Unverified"
    else:
        status = "Flagged"

    reason = " ".join(reasons) if reasons else "No major issues detected; accepted as a standard factual statement."
    return status, reason, flags


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def analyze_text(text: str) -> dict:
    """
    Analyze input text for hallucinations, bias, emotional manipulation,
    unverified statistics, and fact-check signals.

    Returns
    -------
    dict
        Structured audit result with overall_trust_score, summary,
        claims list (with per-claim flags), and detailed metrics.
    """
    stripped = text.strip()
    if not stripped:
        return {
            "overall_trust_score": 0.0,
            "summary": "No text provided for analysis.",
            "claims": [],
            "metrics": {
                "fact_check": {"verified_count": 0, "debunked_count": 0, "neutral_count": 0},
                "hallucination_count": 0,
                "bias_detected": False,
                "bias_count": 0,
                "emotional_manipulation_score": 0.0,
                "emotional_count": 0,
                "unverified_stats_count": 0,
                "total_claims": 0,
            },
        }

    # ── Split into sentences / claims ────────────────────────────────────────
    raw_claims = re.split(r"(?<=[.?!])\s+", stripped)
    raw_claims = [c.strip() for c in raw_claims if c.strip()]

    # ── Evaluate each claim ───────────────────────────────────────────────────
    claims = []
    all_confidences = []
    total_emotional = 0
    unverified_stats = 0
    bias_word_total = 0
    hallucination_count = 0
    fact_verified_count = 0
    fact_debunked_count = 0
    fact_neutral_count = 0

    for idx, claim_text in enumerate(raw_claims, start=1):
        tokens = _tokenize_lower(claim_text)
        confidence = _sentence_confidence(claim_text)
        status, reason, flags = _classify_claim(claim_text, confidence)

        all_confidences.append(confidence)
        total_emotional += _count_emotional_words(tokens)
        bias_word_total += _count_bias_words(tokens)

        if "hallucination" in flags:
            hallucination_count += 1
        if "unverified_stat" in flags:
            unverified_stats += 1
        if "fact_verified" in flags:
            fact_verified_count += 1
        elif "fact_debunked" in flags:
            fact_debunked_count += 1
        else:
            fact_neutral_count += 1

        claims.append({
            "id": idx,
            "claim_text": claim_text,
            "status": status,
            "confidence": confidence,
            "reason": reason,
            "flags": flags,
        })

    # ── Aggregate metrics ─────────────────────────────────────────────────────
    avg_confidence = sum(all_confidences) / len(all_confidences) if all_confidences else 0.0

    flagged_count = sum(1 for c in claims if c["status"] == "Flagged")
    unverified_count = sum(1 for c in claims if c["status"] == "Unverified")
    total = len(claims)

    penalty = (flagged_count * 0.15 + unverified_count * 0.07) / max(total, 1)
    raw_score = avg_confidence - penalty
    overall_trust_score = round(max(0.0, min(1.0, raw_score)) * 100, 1)

    # Emotional manipulation score (0–100)
    emo_max = total * 3
    emotional_score = round(min(total_emotional / max(emo_max, 1), 1.0) * 100, 1)

    bias_detected = bias_word_total > 0

    # ── Build summary ─────────────────────────────────────────────────────────
    if overall_trust_score >= 80:
        verdict = "High trust. The text appears largely factual with minimal red flags."
    elif overall_trust_score >= 55:
        verdict = "Moderate trust. Some claims require independent verification."
    elif overall_trust_score >= 30:
        verdict = "Low trust. Multiple unverified or emotionally biased claims detected."
    else:
        verdict = "Very low trust. The text contains significant hallucination or bias indicators."

    verified_count = sum(1 for c in claims if c["status"] == "Verified")
    summary = (
        f"{verdict} "
        f"Analysed {total} claim(s): "
        f"{verified_count} verified, "
        f"{unverified_count} unverified, "
        f"{flagged_count} flagged."
    )

    return {
        "overall_trust_score": overall_trust_score,
        "summary": summary,
        "claims": claims,
        "metrics": {
            "fact_check": {
                "verified_count": fact_verified_count,
                "debunked_count": fact_debunked_count,
                "neutral_count": fact_neutral_count,
            },
            "hallucination_count": hallucination_count,
            "bias_detected": bias_detected,
            "bias_count": bias_word_total,
            "emotional_manipulation_score": emotional_score,
            "emotional_count": total_emotional,
            "unverified_stats_count": unverified_stats,
            "total_claims": total,
        },
    }
