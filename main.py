"""
main.py

Entry point for the FactShield AI Hallucination & Bias Auditor Web Application & API.
Run locally with:   python main.py
Or in dev mode:     uvicorn main:app --host 0.0.0.0 --port 8000 --reload
"""

import sys
import os
import socket
import logging
from typing import Optional

# ---------------------------------------------------------------------------
# Windows UTF-8 Terminal safety — prevents UnicodeEncodeError crashes
# ---------------------------------------------------------------------------
if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from services.analyzer import analyze_text

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("factshield.main")

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
# CORS – public, credential-less API. Restrict with e.g.
#   CORS_ORIGINS="https://you.github.io,https://factshield.example.com"
# (Wildcard origins must not be combined with allow_credentials=True.)
# ---------------------------------------------------------------------------

CORS_ORIGINS = [o.strip() for o in os.environ.get("CORS_ORIGINS", "*").split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Pydantic schemas
# ---------------------------------------------------------------------------

MAX_TEXT_LENGTH = int(os.environ.get("MAX_TEXT_LENGTH", "10000"))


class TextRequest(BaseModel):
    """Request body for the /analyze endpoint."""
    text: str = Field("", max_length=MAX_TEXT_LENGTH)
    sarvam_api_key: Optional[str] = Field(None, max_length=512)


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

    Sarvam AI failures already degrade to the heuristic engine inside
    ``analyze_text``; anything raised here is a genuine bug and is reported as
    a 500 rather than masked with a fabricated "high trust" result.
    """
    try:
        return analyze_text(request.text, sarvam_api_key=request.sarvam_api_key)
    except Exception:
        logger.exception("Analysis failed")
        raise HTTPException(status_code=500, detail="Analysis failed due to an internal error.")


# ---------------------------------------------------------------------------
# Static Web Hosting (Serves React frontend on the web)
# ---------------------------------------------------------------------------

FRONTEND_DIST = os.path.realpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "frontend", "dist"))

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
    @app.get("/{full_path:path}", tags=["Web App"], include_in_schema=False)
    async def serve_spa(full_path: str):
        # Unknown API-looking or asset paths should 404, not return the SPA shell.
        if full_path.startswith(("api/", "assets/")):
            raise HTTPException(status_code=404, detail="Not Found")
        file_path = os.path.realpath(os.path.join(FRONTEND_DIST, full_path))
        # Never serve anything outside the build directory.
        if file_path.startswith(FRONTEND_DIST + os.sep) and os.path.isfile(file_path):
            return FileResponse(file_path)
        return FileResponse(os.path.join(FRONTEND_DIST, "index.html"))
else:
    @app.get("/", tags=["Health"])
    async def root_fallback():
        return {"status": "active", "note": "Frontend not built yet. Run npm run build inside frontend/"}


# ---------------------------------------------------------------------------
# Web Entry Point with Automatic Port Conflict Resolution
# ---------------------------------------------------------------------------

def is_port_in_use(port_num: int) -> bool:
    """Check if a TCP port is already open/occupied."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        return s.connect_ex(("127.0.0.1", port_num)) == 0


if __name__ == "__main__":
    import uvicorn

    port = int(os.environ.get("PORT", 8000))
    host = os.environ.get("HOST", "0.0.0.0")

    # Auto-resolve port collision if default 8000 is occupied by a background process
    if "PORT" not in os.environ and is_port_in_use(port):
        for candidate_port in range(port + 1, port + 10):
            if not is_port_in_use(candidate_port):
                print(f"[Notice] Port {port} is occupied. Automatically routing to port {candidate_port}.")
                port = candidate_port
                break

    print("\n" + "=" * 60)
    print(f"  FactShield Web Application & API is running on http://{host}:{port}")
    print("=" * 60)
    print(f"  Web Interface : http://localhost:{port}")
    print(f"  Swagger Docs  : http://localhost:{port}/docs")
    print(f"  ReDoc Docs    : http://localhost:{port}/redoc")
    print(f"  Health Check  : http://localhost:{port}/api/health")
    print("=" * 60 + "\n")

    uvicorn.run("main:app", host=host, port=port, reload=False)