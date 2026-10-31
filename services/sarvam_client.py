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

SARVAM_API_URL = "https://api.sarvam.ai/v1/chat/completions"
DEFAULT_MODEL = "sarvam-105b"

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


def analyze_with_sarvam(text: str, api_key: str = None) -> dict:
    """
    Perform deep LLM audit using Sarvam AI (sarvam-105b).

    Parameters
    ----------
    text : str
        Text to audit.
    api_key : str, optional
        Sarvam AI API key/token. If None, reads from env.

    Returns
    -------
    dict
        Structured audit report matching FactShield schema,
        or None if API call fails.
    """
    key = get_sarvam_api_key(api_key)
    if not key:
        logger.info("No Sarvam API key found. Skipping Sarvam AI analysis.")
        return None

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

    req_data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(SARVAM_API_URL, data=req_data, method="POST")

    # Pass both Authorization and api-subscription-key for broad Sarvam gateway support
    req.add_header("Content-Type", "application/json")
    req.add_header("Authorization", f"Bearer {key}")
    req.add_header("api-subscription-key", key)

    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            raw_response = resp.read().decode("utf-8")
            data = json.loads(raw_response)

            # Extract message content from OpenAI-compatible response format
            content = data["choices"][0]["message"]["content"].strip()

            # Clean markdown code blocks if the model wrapped it in ```json ... ```
            if content.startswith("```"):
                content = re.sub(r"^```(?:json)?\s*", "", content)
                content = re.sub(r"\s*```$", "", content)

            audit_result = json.loads(content)

            # Ensure engine metadata tag is included
            audit_result["engine"] = {
                "name": "Sarvam AI",
                "model": DEFAULT_MODEL,
                "credits_used": True,
            }
            return audit_result

    except urllib.error.HTTPError as e:
        error_body = ""
        try:
            error_body = e.read().decode("utf-8")
        except Exception:
            pass
        logger.error(f"Sarvam AI API HTTP {e.code}: {e.reason} - {error_body}")
        raise ValueError(f"Sarvam AI Error ({e.code}): {error_body or e.reason}")

    except Exception as e:
        logger.error(f"Failed to analyze with Sarvam AI: {str(e)}")
        raise e
