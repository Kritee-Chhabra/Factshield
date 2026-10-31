"""
services/analyzer.py

Heuristic text analysis engine for FactShield.
Evaluates submitted text across 6 dimensions:
  1. Fact Checking (verifies claims using citations, language signals, and domain sources)
  2. Hallucination Detection (identifies absolute certainty, fabrications, and vague authority)
  3. Bias Detection (detects slanted rhetoric, one-sided arguments, and loaded language)
  4. Emotional Manipulation (detects sensationalist, alarming, or fear-inducing triggers)
  5. Statistics Verification (flags unverified percentages and numbers without citations)
  6. Trust Score (synthesizes a multi-dimensional credibility score from 0 to 100)

Every engine (heuristic or LLM) produces the same canonical report shape via
``build_report`` so the frontend can rely on a single schema.

NOTE: frontend/src/services/localAnalyzer.js mirrors this engine for static
hosting (GitHub Pages). Keep the lexicons and patterns in sync.
"""

import logging
import math
import re

from services.sarvam_client import analyze_with_sarvam, get_sarvam_api_key

logger = logging.getLogger("factshield.analyzer")

# ---------------------------------------------------------------------------
# Lexicons
# ---------------------------------------------------------------------------

ABSOLUTE_CLAIM_TERMS = (
    "always", "never", "definitely", "undoubtedly", "proven", "guaranteed",
    "impossible", "unquestionably", "indisputable", "certainly", "100%",
    "unconditionally", "infallible", "undeniable", "absolute", "completely",
    "without doubt", "everyone knows", "it's obvious", "of course",
)

HALLUCINATION_PHRASES = (
    "experts agree", "everyone knows", "studies show", "research proves",
    "scientists have found", "widely known", "without doubt", "it is obvious",
    "conclusively proven", "unanimously accepted", "it is common knowledge",
)

EMOTIONAL_TRIGGER_TERMS = (
    "shocking", "devastating", "miracle", "catastrophic", "terrifying",
    "horrific", "unbelievable", "nightmare", "disastrous", "apocalyptic",
    "mind-blowing", "jaw-dropping", "sensational", "panic", "agony",
    "ruin", "destroy", "horrifying", "frightening", "deadly",
)

BIAS_INDICATOR_TERMS = (
    "obviously", "clearly", "naturally", "as expected", "of course",
    "needless to say", "undeniably", "plainly", "predictably", "unquestionably",
    "patently", "morally superior", "corrupt", "malicious", "evil",
)


def _term_pattern(terms) -> re.Pattern:
    """
    Compile a case-insensitive matcher for whole words *and* multi-word /
    hyphenated phrases. Hyphens count as part of a word so that e.g.
    "mind-blowing" matches as one term but "destroy" does not match "destroy-er".
    """
    alternation = "|".join(re.escape(t) for t in sorted(terms, key=len, reverse=True))
    return re.compile(rf"(?<![\w-])(?:{alternation})(?![\w-])", re.IGNORECASE)


ABSOLUTE_PATTERN = _term_pattern(ABSOLUTE_CLAIM_TERMS)
HALLUCINATION_PATTERN = _term_pattern(HALLUCINATION_PHRASES)
EMOTIONAL_PATTERN = _term_pattern(EMOTIONAL_TRIGGER_TERMS)
BIAS_PATTERN = _term_pattern(BIAS_INDICATOR_TERMS)

# Percentages, currency amounts and counted quantities. Deliberately avoids
# trailing \b after symbols like "%" (a \b between "%" and a space never matches).
STAT_PATTERN = re.compile(
    r"(?<![\w.])\d+(?:[.,]\d+)*\s?%"
    r"|[$€£₹]\s?\d+(?:[.,]\d+)*(?:\s*(?:k|m|bn|billion|million|trillion|crore|lakh)\b)?"
    r"|\b\d+(?:,\d{3})*(?:\.\d+)?\s*(?:percent|per cent|times|fold|people|users|"
    r"patients|cases|deaths|billion|million|trillion)\b",
    re.IGNORECASE,
)

# Citation phrases and organisation names (case-insensitive).
_CITATION_PHRASES = re.compile(
    r"(?<!\w)(?:according to|published in|cited by|reported by|peer-reviewed|journal of|"
    r"the lancet|lancet|reuters|associated press|world bank|world health organi[sz]ation|"
    r"international energy agency|centers for disease control|stanford|harvard|oxford|"
    r"university of|et al\.)(?!\w)",
    re.IGNORECASE,
)

# Acronyms / proper nouns that collide with ordinary words when lowercased
# ("who", "nature", "mit"), so they must match case-sensitively.
_CITATION_ACRONYMS = re.compile(r"\b(?:WHO|CDC|NASA|IEA|BBC|NIH|MIT|Nature)\b")

FACT_CHECK_POSITIVE = re.compile(
    r"\b(?:confirmed|verified|documented|corroborated|authenticated|peer-reviewed|"
    r"official data|established by|substantiated)\b",
    re.IGNORECASE,
)

FACT_CHECK_NEGATIVE = re.compile(
    r"\b(?:false|incorrect|debunked|misleading|inaccurate|disputed|disproven|"
    r"unfounded|myth|hoax|conspiracy|rumor)\b",
    re.IGNORECASE,
)

VALID_STATUSES = ("Verified", "Unverified", "Flagged")
VALID_FLAGS = (
    "hallucination", "bias", "emotional", "unverified_stat", "fact_verified", "fact_debunked",
)

# ---------------------------------------------------------------------------
# Signal helpers
# ---------------------------------------------------------------------------


def _distinct_matches(pattern: re.Pattern, text: str) -> int:
    """Number of distinct lexicon terms found in ``text``."""
    return len({m.lower() for m in pattern.findall(text)})


def _count_emotional_terms(text: str) -> int:
    return _distinct_matches(EMOTIONAL_PATTERN, text)


def _count_bias_terms(text: str) -> int:
    return _distinct_matches(BIAS_PATTERN, text)


def _has_absolute_claim(text: str) -> bool:
    return bool(ABSOLUTE_PATTERN.search(text))


def _has_hallucination_phrase(text: str) -> bool:
    return bool(HALLUCINATION_PATTERN.search(text))


def _has_stat(text: str) -> bool:
    return bool(STAT_PATTERN.search(text))


def _has_citation(text: str) -> bool:
    return bool(_CITATION_PHRASES.search(text) or _CITATION_ACRONYMS.search(text))


def _fact_check_signal(text: str) -> str:
    """Return 'positive', 'negative', or 'neutral' based on fact-check language."""
    if FACT_CHECK_NEGATIVE.search(text):
        return "negative"
    if FACT_CHECK_POSITIVE.search(text) or _has_citation(text):
        return "positive"
    return "neutral"


def _sentence_confidence(claim: str) -> float:
    """Return a 0.0–1.0 confidence score for an individual claim."""
    score = 0.85  # neutral confident baseline
    has_cite = _has_citation(claim)
    emo = _count_emotional_terms(claim)
    bias = _count_bias_terms(claim)

    # Penalties
    if _has_absolute_claim(claim):
        score -= 0.30
    if emo:
        score -= 0.10 * min(emo, 3)
    if bias:
        score -= 0.08 * min(bias, 3)
    if _has_stat(claim) and not has_cite:
        score -= 0.20
    if _has_hallucination_phrase(claim) and not has_cite:
        score -= 0.25
    if FACT_CHECK_NEGATIVE.search(claim):
        score -= 0.40

    # Boosts
    if has_cite:
        score += 0.15
    if FACT_CHECK_POSITIVE.search(claim):
        score += 0.10

    return round(max(0.10, min(1.0, score)), 2)


def split_into_claims(text: str) -> list[str]:
    """
    Split arbitrary user text into discrete claims.
    Gracefully handles paragraphs, bullet lists, numbered points, and sentences.
    """
    normalized = text.replace("\r\n", "\n").replace("\r", "\n")
    lines = [line.strip() for line in normalized.split("\n") if line.strip()]

    claims = []
    for line in lines:
        # Strip leading bullet indicators (e.g., "- ", "* ", "1. ", "• ")
        cleaned = re.sub(r"^[*\-•–—>\s]+", "", line)
        cleaned = re.sub(r"^\d+[.)]\s*", "", cleaned).strip()
        if not cleaned:
            continue

        # Split on sentence boundaries if multiple sentences exist within a single line
        parts = re.split(r"(?<=[.?!…])\s+(?=[A-Z0-9\"'“‘ऄ-ॿ])", cleaned)
        claims.extend(p.strip() for p in parts if p.strip())

    if not claims and text.strip():
        claims = [text.strip()]

    return claims


def _dimensions_for(status: str, flags: list[str], has_stat: bool = False, has_cite: bool = False) -> dict:
    """Per-claim dimension status used by the UI report tabs."""
    if "fact_debunked" in flags:
        fact = "debunked"
    elif "fact_verified" in flags or status == "Verified":
        fact = "verified"
    else:
        fact = "unverified"

    if "unverified_stat" in flags:
        stats = "unverified"
    elif has_stat and has_cite:
        stats = "cited"
    else:
        stats = "clean"

    return {
        "fact_check": fact,
        "hallucination": "flagged" if ("hallucination" in flags or status == "Flagged") else "clean",
        "bias": "flagged" if "bias" in flags else "clean",
        "emotional": "flagged" if "emotional" in flags else "clean",
        "statistics": stats,
    }


def _classify_claim(claim: str, confidence: float) -> tuple[str, str, list[str], dict]:
    """
    Classify a claim and return (status, reason, flags, dimensions).
    Guarantees consistent mapping between status and dimensional flags.
    """
    reasons = []
    flags = []

    has_cite = _has_citation(claim)
    has_abs = _has_absolute_claim(claim)
    has_hallucination = _has_hallucination_phrase(claim) and not has_cite
    has_stat = _has_stat(claim)
    emo_count = _count_emotional_terms(claim)
    bias_count = _count_bias_terms(claim)
    fact_signal = _fact_check_signal(claim)

    # 1. Hallucination checks
    if has_abs:
        reasons.append("Contains absolute or extreme certainty assertions typical of fabricated text.")
        flags.append("hallucination")
    if has_hallucination:
        reasons.append("Cites vague authority ('everyone knows', 'studies show') without a named citation.")
        if "hallucination" not in flags:
            flags.append("hallucination")

    # 2. Statistics check
    if has_stat and not has_cite:
        reasons.append("Statistical metrics or percentages presented without a verifiable source.")
        flags.append("unverified_stat")

    # 3. Emotional manipulation check
    if emo_count:
        reasons.append(f"Uses {emo_count} emotionally charged or sensationalist trigger word(s).")
        flags.append("emotional")

    # 4. Bias check
    if bias_count:
        reasons.append(f"Contains {bias_count} bias indicator(s) suggesting one-sided framing.")
        flags.append("bias")

    # 5. Fact check
    if fact_signal == "negative":
        reasons.append("Contains language identifying a debunked, disproven, or false assertion.")
        flags.append("fact_debunked")
    elif fact_signal == "positive":
        reasons.append("Includes verified source citation or documented evidence.")
        flags.append("fact_verified")

    # 6. Overall status
    if has_abs or has_hallucination or fact_signal == "negative" or confidence < 0.45:
        status = "Flagged"
        if not flags:
            flags.append("hallucination")
    elif (has_stat and not has_cite) or confidence < 0.75:
        status = "Unverified"
    else:
        status = "Verified"
        if "fact_verified" not in flags:
            flags.append("fact_verified")

    reason = " ".join(reasons) if reasons else "Logical assertion supported by standard factual tone."
    return status, reason, flags, _dimensions_for(status, flags, has_stat, has_cite)


# ---------------------------------------------------------------------------
# Report aggregation (shared by every engine)
# ---------------------------------------------------------------------------


def _verdict(score: float) -> str:
    if score >= 75:
        return "High trust. The content demonstrates sound factual integrity with minimal risk."
    if score >= 45:
        return "Moderate trust. Some assertions require independent verification."
    return "Low trust. Multiple unverified, biased, or hallucinated claims detected."


def build_report(
    claims: list[dict],
    *,
    emotional_terms: int,
    bias_terms: int,
    engine: dict,
    trust_override: float | None = None,
    emotional_override: float | None = None,
    summary: str | None = None,
) -> dict:
    """Aggregate per-claim results into the canonical FactShield report."""
    total = len(claims)
    denom = max(total, 1)

    verified_count = sum(1 for c in claims if c["status"] == "Verified")
    unverified_count = sum(1 for c in claims if c["status"] == "Unverified")
    flagged_count = sum(1 for c in claims if c["status"] == "Flagged")
    hallucination_count = sum(1 for c in claims if "hallucination" in c["flags"])
    unverified_stats = sum(1 for c in claims if "unverified_stat" in c["flags"])
    debunked_count = sum(1 for c in claims if "fact_debunked" in c["flags"])

    # 1. Fact checking (0-100, higher is better)
    fact_score = (verified_count / denom) * 100 - (debunked_count / denom) * 40
    fact_score = round(max(0.0, min(100.0, fact_score)), 1) if total else 0.0

    # 2. Hallucination cleanliness (100 = clean)
    hallucination_score = round(max(0.0, 100.0 - (hallucination_count / denom) * 100), 1)

    # 3. Bias neutrality (100 = neutral)
    bias_score = round(max(0.0, 100.0 - (bias_terms / max(total * 2, 1)) * 100), 1)

    # 4. Emotional manipulation (0 = calm, 100 = heavy manipulation)
    if emotional_override is not None:
        emotional_score = round(max(0.0, min(100.0, emotional_override)), 1)
    else:
        emotional_score = round(min((emotional_terms / max(total * 2, 1)) * 100, 100.0), 1)

    # 5. Statistics reliability (100 = all cited)
    stat_score = round(max(0.0, 100.0 - (unverified_stats / denom) * 100), 1)

    # 6. Overall trust (composite)
    if trust_override is not None:
        trust = round(max(0.0, min(100.0, trust_override)), 1)
    elif total:
        avg_conf = sum(c["confidence"] for c in claims) / total
        composite = (
            avg_conf * 0.40
            + (fact_score / 100) * 0.25
            + (hallucination_score / 100) * 0.20
            + (bias_score / 100) * 0.15
        )
        penalty = (flagged_count * 0.12 + unverified_count * 0.05) / total
        trust = round(max(0.05, min(1.0, composite - penalty)) * 100, 1)
    else:
        trust = 0.0

    if summary is None:
        if total:
            summary = (
                f"{_verdict(trust)} Analysed {total} claim(s): "
                f"{verified_count} verified, {unverified_count} unverified, {flagged_count} flagged."
            )
        else:
            summary = "No text provided for analysis. Please enter text to audit."

    return {
        "overall_trust_score": trust,
        "summary": summary,
        "claims": claims,
        "metrics": {
            "fact_check": {
                "verified_count": verified_count,
                "debunked_count": debunked_count,
                "neutral_count": max(0, total - verified_count - debunked_count),
                "score": fact_score,
            },
            "hallucination": {
                "count": hallucination_count,
                "score": hallucination_score,
                "risk": "Severe" if hallucination_score < 40 else "Caution" if hallucination_score < 75 else "Clean",
            },
            "bias": {
                "detected": bias_terms > 0,
                "count": bias_terms,
                "score": bias_score,
                "level": "Heavily Biased" if bias_score < 50 else "Slightly Slanted" if bias_score < 85 else "Neutral",
            },
            "emotional": {
                "score": emotional_score,
                "count": emotional_terms,
                "intensity": (
                    "High Manipulation" if emotional_score > 50
                    else "Moderate Urgency" if emotional_score > 20
                    else "Calm / Objective"
                ),
            },
            "statistics": {
                "unverified_count": unverified_stats,
                "score": stat_score,
                "status": "Unverified Statistics" if unverified_stats > 0 else "All Cited",
            },
            "total_claims": total,
        },
        "scores": {
            "trust": trust,
            "fact_checking": fact_score,
            "hallucination": hallucination_score,
            "bias": bias_score,
            "emotional": emotional_score,
            "statistics": stat_score,
        },
        "engine": engine,
    }


# ---------------------------------------------------------------------------
# LLM response normalisation
# ---------------------------------------------------------------------------


def _as_float(value) -> float | None:
    try:
        f = float(value)
    except (TypeError, ValueError):
        return None
    return f if math.isfinite(f) else None


def _as_count(value) -> int | None:
    f = _as_float(value)
    return max(0, int(f)) if f is not None else None


def normalize_llm_report(raw: dict, engine: dict) -> dict:
    """
    Coerce an LLM-produced audit (which follows a looser, flatter schema and may
    contain out-of-range or missing values) into the canonical report shape.
    Raises ValueError if it contains no usable claims.
    """
    raw_claims = raw.get("claims")
    if not isinstance(raw_claims, list):
        raise ValueError("LLM response has no 'claims' list")

    claims = []
    for item in raw_claims:
        if not isinstance(item, dict):
            continue
        text = str(item.get("claim_text") or "").strip()
        if not text:
            continue

        status = str(item.get("status") or "").strip().capitalize()
        if status not in VALID_STATUSES:
            status = "Unverified"

        confidence = _as_float(item.get("confidence"))
        if confidence is None:
            confidence = 0.5
        elif confidence > 1:  # model answered in percent
            confidence /= 100
        confidence = round(max(0.0, min(1.0, confidence)), 2)

        raw_flags = item.get("flags") if isinstance(item.get("flags"), list) else []
        flags = []
        for f in raw_flags:
            f = str(f).strip().lower()
            if f in VALID_FLAGS and f not in flags:
                flags.append(f)

        claims.append({
            "id": len(claims) + 1,
            "claim_text": text,
            "status": status,
            "confidence": confidence,
            "reason": str(item.get("reason") or "Assessed by language model."),
            "flags": flags,
            "dimensions": _dimensions_for(status, flags),
        })

    if not claims:
        raise ValueError("LLM response contained no usable claims")

    metrics = raw.get("metrics") if isinstance(raw.get("metrics"), dict) else {}

    def term_count(key: str, flag: str) -> int:
        reported = _as_count(metrics.get(key))
        return reported if reported is not None else sum(1 for c in claims if flag in c["flags"])

    trust = _as_float(raw.get("overall_trust_score"))
    if trust is not None and 0 < trust <= 1:  # model answered as a fraction
        trust *= 100

    summary = raw.get("summary")
    return build_report(
        claims,
        emotional_terms=term_count("emotional_count", "emotional"),
        bias_terms=term_count("bias_count", "bias"),
        emotional_override=_as_float(metrics.get("emotional_manipulation_score")),
        trust_override=trust,
        summary=str(summary) if summary else None,
        engine=engine,
    )


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

HEURISTIC_ENGINE = {"name": "Heuristic Engine", "model": "local", "credits_used": False}


def analyze_heuristic(text: str) -> dict:
    """Run the built-in, dependency-free heuristic engine."""
    stripped = text.strip() if text else ""
    claims = []
    emotional_terms = 0
    bias_terms = 0

    for idx, claim_text in enumerate(split_into_claims(stripped), start=1):
        confidence = _sentence_confidence(claim_text)
        status, reason, flags, dimensions = _classify_claim(claim_text, confidence)
        emotional_terms += _count_emotional_terms(claim_text)
        bias_terms += _count_bias_terms(claim_text)
        claims.append({
            "id": idx,
            "claim_text": claim_text,
            "status": status,
            "confidence": confidence,
            "reason": reason,
            "flags": flags,
            "dimensions": dimensions,
        })

    return build_report(
        claims,
        emotional_terms=emotional_terms,
        bias_terms=bias_terms,
        engine=dict(HEURISTIC_ENGINE),
    )


def analyze_text(text: str, sarvam_api_key: str | None = None) -> dict:
    """
    Analyze input text across all 6 FactShield dimensions.

    Uses Sarvam AI when an API key is supplied (request or environment) and
    falls back to the heuristic engine if the LLM call fails or returns an
    unusable response.
    """
    stripped = text.strip() if text else ""
    if not stripped:
        return analyze_heuristic("")

    active_key = get_sarvam_api_key(sarvam_api_key)
    if active_key:
        try:
            raw, engine = analyze_with_sarvam(stripped, active_key)
            return normalize_llm_report(raw, engine)
        except Exception as exc:  # network, HTTP, JSON or schema errors
            logger.warning("Sarvam AI analysis failed (%s); falling back to heuristic engine.", exc)
            report = analyze_heuristic(stripped)
            report["engine"]["notice"] = (
                "Sarvam AI request failed, so this report was produced by the built-in heuristic engine."
            )
            return report

    return analyze_heuristic(stripped)
