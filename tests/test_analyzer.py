import pytest

from services import analyzer
from services.analyzer import (
    analyze_heuristic,
    analyze_text,
    normalize_llm_report,
    split_into_claims,
)


@pytest.mark.parametrize(
    "text",
    [
        "Over 50% of people agree.",
        "It grew 78%.",
        "Revenue fell by 12.4 % last year.",
        "They lost $840 billion in value.",
        "The scheme cost ₹500 crore.",
        "About 3,000 patients were enrolled.",
    ],
)
def test_detects_statistics(text):
    assert analyzer._has_stat(text)


@pytest.mark.parametrize("text", ["The meeting is in 2024.", "Chapter 3 explains it.", "Version 2.0 shipped."])
def test_ignores_plain_numbers(text):
    assert not analyzer._has_stat(text)


@pytest.mark.parametrize(
    "text",
    [
        "According to the WHO, exercise helps.",
        "Smith et al. reported a decline.",
        "A paper in Nature showed this.",
        "Data from the World Health Organization confirms it.",
    ],
)
def test_detects_citations(text):
    assert analyzer._has_citation(text)


@pytest.mark.parametrize(
    "text",
    [
        "People who exercise live longer.",  # pronoun, not the WHO
        "It is human nature to worry.",
        "I submitted the form.",  # contains 'mit' substring
    ],
)
def test_no_false_positive_citations(text):
    assert not analyzer._has_citation(text)


def test_multi_word_and_hyphenated_terms_match():
    assert analyzer._count_emotional_terms("A mind-blowing, jaw-dropping reveal.") == 2
    assert analyzer._count_bias_terms("Needless to say, they are morally superior.") == 2
    assert analyzer._has_absolute_claim("This works 100% of the time.")


def test_statistics_sample_is_flagged():
    text = (
        "Over 96.8% of modern artificial intelligence outputs are proven to lose $840 billion "
        "in enterprise value, and 78% of remote workers suffer catastrophic memory loss."
    )
    report = analyze_heuristic(text)
    assert report["metrics"]["statistics"]["unverified_count"] == 1
    assert report["scores"]["statistics"] < 100
    assert "unverified_stat" in report["claims"][0]["flags"]


def test_cited_statistic_is_not_flagged():
    report = analyze_heuristic(
        "According to peer-reviewed research published in Nature, efficiency improved by 12.4%."
    )
    claim = report["claims"][0]
    assert "unverified_stat" not in claim["flags"]
    assert claim["dimensions"]["statistics"] == "cited"
    assert claim["status"] == "Verified"


def test_report_shape_and_bounds():
    report = analyze_heuristic("Clearly this is shocking. Everyone knows it is always true.")
    assert set(report) >= {"overall_trust_score", "summary", "claims", "metrics", "scores", "engine"}
    for value in report["scores"].values():
        assert 0 <= value <= 100
    assert report["metrics"]["total_claims"] == len(report["claims"]) == 2
    assert all(c["status"] in ("Verified", "Unverified", "Flagged") for c in report["claims"])


def test_empty_text():
    report = analyze_text("   ")
    assert report["claims"] == []
    assert report["overall_trust_score"] == 0.0


def test_split_into_claims_handles_bullets_and_sentences():
    text = "- First point. Second point!\n2) Third point\n\n• Fourth"
    assert split_into_claims(text) == ["First point.", "Second point!", "Third point", "Fourth"]


def test_normalize_llm_report_coerces_loose_output():
    raw = {
        "overall_trust_score": 0.62,  # fraction instead of percent
        "summary": "Mixed.",
        "claims": [
            {"claim_text": "A", "status": "flagged", "confidence": 40, "flags": ["bias", "bogus", "bias"]},
            {"claim_text": "B", "status": "weird", "confidence": "n/a"},
            {"claim_text": "  "},
            "not a dict",
        ],
        "metrics": {"emotional_manipulation_score": 150, "bias_count": 1},
    }
    report = normalize_llm_report(raw, {"name": "Sarvam AI", "model": "m", "credits_used": True})
    a, b = report["claims"]
    assert (a["status"], a["confidence"], a["flags"]) == ("Flagged", 0.4, ["bias"])
    assert a["dimensions"]["bias"] == "flagged"
    assert (b["status"], b["confidence"]) == ("Unverified", 0.5)
    assert report["overall_trust_score"] == 62.0
    assert report["scores"]["emotional"] == 100.0
    assert report["metrics"]["total_claims"] == 2


def test_normalize_llm_report_rejects_empty():
    with pytest.raises(ValueError):
        normalize_llm_report({"claims": []}, {})


def test_sarvam_failure_falls_back_to_heuristics(monkeypatch):
    def boom(text, key):
        raise ValueError("network down")

    monkeypatch.setattr(analyzer, "analyze_with_sarvam", boom)
    report = analyze_text("The sky is blue.", sarvam_api_key="test-key")
    assert report["engine"]["credits_used"] is False
    assert "notice" in report["engine"]
    assert report["claims"]


def test_sarvam_success_is_normalized(monkeypatch):
    raw = {"overall_trust_score": 80, "claims": [{"claim_text": "X", "status": "Verified", "confidence": 0.9}]}
    engine = {"name": "Sarvam AI", "model": "sarvam-105b", "credits_used": True}
    monkeypatch.setattr(analyzer, "analyze_with_sarvam", lambda text, key: (raw, engine))
    report = analyze_text("X", sarvam_api_key="k")
    assert report["engine"]["credits_used"] is True
    assert report["scores"]["trust"] == 80.0
    assert report["claims"][0]["dimensions"]["fact_check"] == "verified"


def _parity_cases():
    import json
    from pathlib import Path

    path = Path(__file__).parent / "fixtures" / "engine_parity.json"
    return json.loads(path.read_text(encoding="utf-8"))


@pytest.mark.parametrize("case", _parity_cases(), ids=lambda c: c["text"][:40])
def test_engine_parity_fixture(case):
    """
    The same fixture is asserted by frontend/src/services/localAnalyzer.test.js,
    keeping the Python and browser engines in lockstep. If you intentionally
    change scoring, regenerate the fixture and update both engines.
    """
    report = analyze_heuristic(case["text"])
    claims = [
        {k: c[k] for k in ("claim_text", "status", "confidence", "flags", "dimensions")}
        for c in report["claims"]
    ]
    assert claims == case["expected"]["claims"]
    assert report["scores"] == case["expected"]["scores"]
