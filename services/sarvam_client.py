"""
services/sarvam_client.py

Client for Sarvam AI LLM API (sarvam-105b).
Uses Python's standard urllib to avoid heavy dependencies,
providing deep semantic analysis for the 6 FactShield checks.
"""

import json
import logging
import os
import re
import urllib.error
import urllib.request

logger = logging.getLogger("factshield.sarvam")

SARVAM_API_URL = os.environ.get("SARVAM_API_URL", "https://api.sarvam.ai/v1/chat/completions")
DEFAULT_MODEL = os.environ.get("SARVAM_MODEL", "sarvam-105b")
REQUEST_TIMEOUT_SECONDS = float(os.environ.get("SARVAM_TIMEOUT", "30"))

SYSTEM_PROMPT = """You are FactShield, an authoritative AI Hallucination & Bias Auditor.
Analyze the user's text for truthfulness, hallucinations, bias, emotional manipulation, and statistics verification.

You MUST respond ONLY with a single valid JSON object, without markdown formatting or code blocks, strictly adhering to this JSON schema:
{
  "overall_trust_score": <float between 0.0 and 100.0>,
  "summary": "<2-3 sentence executive audit verdict>",
  "claims": [
    {
      "id": <integer starting at 1>,
      "claim_text": "<exact sentence or assertion>",
      "status": "<Verified | Unverified | Flagged>",
      "confidence": <float between 0.0 and 1.0>,
      "reason": "<clear explanation for this assessment>",
      "flags": ["<any of: hallucination, bias, emotional, unverified_stat, fact_verified, fact_debunked>"]
    }
  ],
  "metrics": {
    "fact_check": {
      "verified_count": <integer>,
      "debunked_count": <integer>,
      "neutral_count": <integer>
    },
    "hallucination_count": <integer>,
    "bias_detected": <boolean>,
    "bias_count": <integer>,
    "emotional_manipulation_score": <float between 0.0 and 100.0>,
    "emotional_count": <integer>,
    "unverified_stats_count": <integer>,
    "total_claims": <integer>
  }
}
"""


def get_sarvam_api_key(override_key: str = None) -> str:
    """
    Retrieve Sarvam API key from override parameter,
    environment variable, or .env file.
    """
    if override_key and override_key.strip():
        return override_key.strip()

    # Check environment variable
    env_key = os.environ.get("SARVAM_API_KEY") or os.environ.get("SARVAM_TOKEN")
    if env_key and env_key.strip():
        return env_key.strip()

    # Check .env file in project root if available
    env_file = os.path.join(os.path.dirname(os.path.dirname(__file__)), ".env")
    if os.path.exists(env_file):
        try:
            with open(env_file, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if line.startswith("SARVAM_API_KEY=") or line.startswith("SARVAM_TOKEN="):
                        val = line.split("=", 1)[1].strip().strip('"').strip("'")
                        if val:
                            return val
        except Exception as e:
            logger.warning(f"Failed to read .env file: {e}")

    return ""


def _extract_json_object(content: str) -> dict:
    """
    Parse the JSON object out of a model reply. Tolerates markdown code fences
    and leading/trailing prose around the object.
    """
    content = content.strip()
    if content.startswith("```"):
        content = re.sub(r"^```(?:json)?\s*", "", content, flags=re.IGNORECASE)
        content = re.sub(r"\s*```$", "", content)
    try:
        parsed = json.loads(content)
    except json.JSONDecodeError:
        start, end = content.find("{"), content.rfind("}")
        if start == -1 or end <= start:
            raise ValueError("Sarvam AI reply did not contain a JSON object")
        parsed = json.loads(content[start:end + 1])
    if not isinstance(parsed, dict):
        raise ValueError("Sarvam AI reply was not a JSON object")
    return parsed


def analyze_with_sarvam(text: str, api_key: str) -> tuple[dict, dict]:
    """
    Perform a deep LLM audit using Sarvam AI.

    Returns ``(raw_report, engine_metadata)``. The raw report follows the looser
    schema in SYSTEM_PROMPT and must be passed through
    ``services.analyzer.normalize_llm_report`` before being returned to clients.

    Raises on missing key, network/HTTP failure, or an unparseable reply so the
    caller can fall back to the heuristic engine.
    """
    if not api_key:
        raise ValueError("No Sarvam API key provided")

    payload = {
        "model": DEFAULT_MODEL,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {
                "role": "user",
                "content": f"Audit the following text across all 6 checks:\n\n{text}",
            },
        ],
        "temperature": 0.1,
    }

    req = urllib.request.Request(
        SARVAM_API_URL,
        data=json.dumps(payload).encode("utf-8"),
        method="POST",
    )
    # Pass both Authorization and api-subscription-key for broad Sarvam gateway support
    req.add_header("Content-Type", "application/json")
    req.add_header("Authorization", f"Bearer {api_key}")
    req.add_header("api-subscription-key", api_key)

    try:
        with urllib.request.urlopen(req, timeout=REQUEST_TIMEOUT_SECONDS) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        error_body = ""
        try:
            error_body = e.read().decode("utf-8", errors="replace")[:500]
        except Exception:
            pass
        logger.error("Sarvam AI API HTTP %s: %s - %s", e.code, e.reason, error_body)
        raise ValueError(f"Sarvam AI Error ({e.code}): {error_body or e.reason}") from e

    try:
        content = data["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError) as e:
        raise ValueError("Unexpected Sarvam AI response format") from e

    engine = {"name": "Sarvam AI", "model": data.get("model") or DEFAULT_MODEL, "credits_used": True}
    return _extract_json_object(content or ""), engine
