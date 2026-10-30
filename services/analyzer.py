"""
services/analyzer.py

Core analysis engine for the AI Hallucination & Bias Auditor.
Heuristically evaluates text claims for hallucinations, bias,
emotional manipulation, and unverified statistics.
"""

import re
import math


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
    # Check multi-word phrases
    raw_lower = raw.lower()
    for phrase in ["without doubt", "everyone knows", "it's obvious", "of course"]:
        if phrase in raw_lower:
            return True
    return False


def _has_stat(text: str) -> bool:
    return bool(STAT_PATTERN.search(text))


def _has_citation(text: str) -> bool:
    return bool(CITATION_PATTERN.search(text))


def _sentence_confidence(claim: str) -> float:
    """
    Return a 0.0–1.0 confidence score for an individual claim.
    Higher = more trustworthy; Lower = more suspicious.
    """
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
        score -= 0.20  # stat without citation is suspicious

    # Bonuses
    if _has_citation(claim):
        score += 0.20
    if len(claim.split()) >= 12:
        score += 0.05  # longer, more detailed claims slightly trusted

    return round(max(0.0, min(1.0, score)), 2)


def _classify_claim(claim: str, confidence: float) -> tuple[str, str]:
    """
    Return (status, reason) based on claim content and confidence.
    """
    tokens = _tokenize_lower(claim)
    has_abs = _has_absolute_claim(tokens, claim)
    has_stat = _has_stat(claim)
    has_cite = _has_citation(claim)
    emo_count = _count_emotional_words(tokens)
    bias_count = _count_bias_words(tokens)

    reasons = []

    if has_abs:
        reasons.append("Contains absolute language (e.g., 'always', 'never', 'guaranteed').")
    if has_stat and not has_cite:
        reasons.append("Statistical claim without a verifiable citation.")
    if emo_count > 0:
        reasons.append(f"Uses {emo_count} emotionally charged word(s) that may skew perception.")
    if bias_count > 0:
        reasons.append(f"Contains {bias_count} potential bias indicator(s).")
    if has_cite:
        reasons.append("Includes a source citation — adds credibility.")

    # Determine status
    if has_abs:
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
    return status, reason


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def analyze_text(text: str) -> dict:
    """
    Analyze input text for hallucinations, bias, and unverified claims.

    Parameters
    ----------
    text : str
        Raw text submitted by the user.

    Returns
    -------
    dict
        Structured audit result containing overall_trust_score, summary,
        claims list, and metrics.
    """
    # ── Guard: empty input ───────────────────────────────────────────────────
    stripped = text.strip()
    if not stripped:
        return {
            "overall_trust_score": 0.0,
            "summary": "No text provided for analysis.",
            "claims": [],
            "metrics": {
                "bias_detected": False,
                "emotional_manipulation_score": 0.0,
                "unverified_stats_count": 0,
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

    for idx, claim_text in enumerate(raw_claims, start=1):
        tokens = _tokenize_lower(claim_text)
        confidence = _sentence_confidence(claim_text)
        status, reason = _classify_claim(claim_text, confidence)

        all_confidences.append(confidence)
        total_emotional += _count_emotional_words(tokens)
        bias_word_total += _count_bias_words(tokens)

        if status == "Unverified" and _has_stat(claim_text):
            unverified_stats += 1

        claims.append(
            {
                "id": idx,
                "claim_text": claim_text,
                "status": status,
                "confidence": confidence,
                "reason": reason,
            }
        )

    # ── Aggregate metrics ─────────────────────────────────────────────────────
    if all_confidences:
        avg_confidence = sum(all_confidences) / len(all_confidences)
    else:
        avg_confidence = 0.0

    # Penalise the overall score for flagged claims
    flagged_count = sum(1 for c in claims if c["status"] == "Flagged")
    unverified_count = sum(1 for c in claims if c["status"] == "Unverified")
    total = len(claims)

    penalty = (flagged_count * 0.15 + unverified_count * 0.07) / max(total, 1)
    raw_score = avg_confidence - penalty
    overall_trust_score = round(max(0.0, min(1.0, raw_score)) * 100, 1)

    # Emotional manipulation score (0–100)
    emo_max = total * 3  # assume max 3 emotional words per sentence
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

    summary = (
        f"{verdict} "
        f"Analysed {total} claim(s): "
        f"{sum(1 for c in claims if c['status'] == 'Verified')} verified, "
        f"{unverified_count} unverified, "
        f"{flagged_count} flagged."
    )

    return {
        "overall_trust_score": overall_trust_score,
        "summary": summary,
        "claims": claims,
        "metrics": {
            "bias_detected": bias_detected,
            "emotional_manipulation_score": emotional_score,
            "unverified_stats_count": unverified_stats,
        },
    }
