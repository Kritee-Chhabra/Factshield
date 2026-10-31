"""
main.py

Entry point for the FactShield AI Hallucination & Bias Auditor Web Application & API.
Run locally with:   uvicorn main:app --host 0.0.0.0 --port 8000 --reload
Or in production:   python main.py
"""

import os
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, field_validator

from services.analyzer import analyze_text

# ---------------------------------------------------------------------------
# App initialisation
# ---------------------------------------------------------------------------

app = FastAPI(
    title="FactShield — AI Hallucination & Bias Auditor",
    description=(
        "Analyses AI-generated text for hallucinations, bias, "
        "emotional manipulation, and unverified statistics. "
        "Returns a comprehensive Trust Score alongside per-claim breakdowns."
    ),
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
)

# ---------------------------------------------------------------------------
# CORS – allows all origins for public web and API access
# ---------------------------------------------------------------------------

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
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
        return v


class HealthResponse(BaseModel):
    status: str


# ---------------------------------------------------------------------------
# API Routes
# ---------------------------------------------------------------------------


@app.get("/api/health", response_model=HealthResponse, tags=["Health"])
async def api_health():
    """Health check endpoint for cloud monitoring and load balancers."""
    return {"status": "active"}


@app.post("/analyze", tags=["Analysis"])
async def analyze(request: TextRequest):
    """
    Analyse submitted text for hallucinations, bias, and unverified claims.
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
# Static Web Hosting (Serves React frontend on the web)
# ---------------------------------------------------------------------------

FRONTEND_DIST = os.path.join(os.path.dirname(__file__), "frontend", "dist")

if os.path.exists(FRONTEND_DIST):
    # Mount assets folder for built JS/CSS
    assets_dir = os.path.join(FRONTEND_DIST, "assets")
    if os.path.exists(assets_dir):
        app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")

    # Serve index.html on root
    @app.get("/", tags=["Web App"])
    async def serve_index():
        return FileResponse(os.path.join(FRONTEND_DIST, "index.html"))

    # Fallback for client-side routing and static files (favicon, etc.)
    @app.get("/{full_path:path}", tags=["Web App"])
    async def serve_spa(full_path: str):
        file_path = os.path.join(FRONTEND_DIST, full_path)
        if os.path.exists(file_path) and os.path.isfile(file_path):
            return FileResponse(file_path)
        return FileResponse(os.path.join(FRONTEND_DIST, "index.html"))
else:
    @app.get("/", response_model=HealthResponse, tags=["Health"])
    async def root_fallback():
        return {"status": "active", "note": "Frontend not built yet. Run npm run build inside frontend/"}


# ---------------------------------------------------------------------------
# Web Entry Point (Runs on port specified by cloud provider or default 8000)
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import uvicorn

    port = int(os.environ.get("PORT", 8000))
    host = os.environ.get("HOST", "0.0.0.0")

    print("\n" + "=" * 60)
    print(f"  FactShield Web Application & API is running on http://{host}:{port}")
    print("=" * 60)
    print(f"  Web Interface : http://localhost:{port}")
    print(f"  Swagger Docs  : http://localhost:{port}/docs")
    print(f"  ReDoc Docs    : http://localhost:{port}/redoc")
    print(f"  Health Check  : http://localhost:{port}/api/health")
    print("=" * 60 + "\n")

    uvicorn.run("main:app", host=host, port=port, reload=False)