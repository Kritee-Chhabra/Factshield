"""
main.py

Entry point for the AI Hallucination & Bias Auditor API.
Run with:  uvicorn main:app --reload
"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, field_validator

from services.analyzer import analyze_text

# ---------------------------------------------------------------------------
# App initialisation
# ---------------------------------------------------------------------------

app = FastAPI(
    title="AI Hallucination Auditor API",
    description=(
        "Analyses AI-generated (or any) text for hallucinations, bias, "
        "emotional manipulation, and unverified statistical claims. "
        "Returns a preliminary Trust Score alongside per-claim breakdowns."
    ),
    version="1.0.0",
    docs_url="/docs",       # Swagger UI  →  http://127.0.0.1:8000/docs
    redoc_url="/redoc",     # ReDoc UI    →  http://127.0.0.1:8000/redoc
)

# ---------------------------------------------------------------------------
# CORS – allow all origins so the React frontend can connect seamlessly
# ---------------------------------------------------------------------------

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],   # tighten to your frontend domain in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Pydantic schemas
# ---------------------------------------------------------------------------


class TextRequest(BaseModel):
    """Request body for the /analyze endpoint."""

    text: str

    @field_validator("text")
    @classmethod
    def text_must_not_be_only_whitespace(cls, v: str) -> str:
        # Allow empty string — the analyzer handles it gracefully
        return v


class HealthResponse(BaseModel):
    status: str


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@app.get("/", response_model=HealthResponse, tags=["Health"])
async def health_check():
    """
    Simple health-check endpoint.
    Returns 200 + {"status": "active"} when the server is running.
    """
    return {"status": "active"}


@app.post("/analyze", tags=["Analysis"])
async def analyze(request: TextRequest):
    """
    Analyse submitted text for hallucinations, bias, and unverified claims.

    ### What it does
    - Splits the input into individual sentence-level claims.
    - Heuristically checks each claim for:
      - **Absolute language** (always, never, guaranteed …)
      - **Unverified statistics** (numbers / percentages without citations)
      - **Emotional manipulation** (shocking, catastrophic …)
      - **Bias indicators** (obviously, everyone knows …)
    - Aggregates a preliminary **Trust Score** (0 – 100).

    ### Returns
    ```json
    {
      "overall_trust_score": 72.5,
      "summary": "Moderate trust …",
      "claims": [
        {
          "id": 1,
          "claim_text": "...",
          "status": "Verified | Unverified | Flagged",
          "confidence": 0.75,
          "reason": "..."
        }
      ],
      "metrics": {
        "bias_detected": false,
        "emotional_manipulation_score": 10.0,
        "unverified_stats_count": 1
      }
    }
    ```
    """
    try:
        result = analyze_text(request.text)
        return result
    except Exception as exc:  # pragma: no cover
        raise HTTPException(
            status_code=500,
            detail=f"Analysis failed: {str(exc)}",
        ) from exc


# ---------------------------------------------------------------------------
# Dev entry-point (python main.py)
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import uvicorn

    print("\n" + "=" * 60)
    print("  AI Hallucination & Bias Auditor API")
    print("=" * 60)
    print("  Swagger docs : http://127.0.0.1:8000/docs")
    print("  ReDoc        : http://127.0.0.1:8000/redoc")
    print("  Health check : GET  http://127.0.0.1:8000/")
    print("  Analyze      : POST http://127.0.0.1:8000/analyze")
    print("=" * 60)
    print("\n  Sample request payload:")
    print(
        """
  POST http://127.0.0.1:8000/analyze
  Content-Type: application/json

  {
    "text": "Scientists have always known that vaccines cause autism. Studies show 95% of children are affected. According to WHO, this claim is completely false and unverified."
  }
    """
    )

    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)
