# FactShield 🛡️ — AI Hallucination & Bias Auditor

> **An advanced, multi-layer verification platform that audits AI-generated text (ChatGPT, Gemini, Claude) for hallucinations, biased framing, emotional manipulation, unverified statistics, and factual accuracy — producing an actionable Trust Score and granular claim-level breakdown.**

---

## 🌐 Live Demo — Try It Now (No Installation Required)

[![🚀 Open Live App](https://img.shields.io/badge/🚀%20Live%20App-kritee--chhabra.github.io%2FFactshield-blue?style=for-the-badge&logo=github)](https://kritee-chhabra.github.io/Factshield/)

**👉 [https://kritee-chhabra.github.io/Factshield/](https://kritee-chhabra.github.io/Factshield/)**

> Open the link above in any browser — no terminal, no Python, no installation needed.
> The full 6-dimension audit engine runs entirely inside your browser via the built-in client-side heuristic engine.
> Optionally connect your **Sarvam AI API key** in the app's token modal for deep LLM-powered analysis.

---

## ✨ Features & Capabilities

FactShield conducts **6 independent verification checks** on submitted text:

| Feature | Description |
|---|---|
| 🔎 **Fact Checking** | Evaluates claims and citations against established domain sources and flags debunked misinformation. |
| 🧠 **Hallucination Detection** | Identifies absolute assertions (*"always"*, *"without doubt"*), fabricated certainties, and vague authority claims (*"studies show"* without citations). |
| ⚖️ **Bias Detection** | Detects loaded adjectives, slanted rhetoric, and one-sided framing. |
| 🎭 **Emotional Manipulation** | Flags sensationalist, fear-inducing, or high-pressure psychological language. |
| 📊 **Statistics Verification** | Highlights percentages, numbers, and metrics presented without verifiable sources. |
| 🛡️ **Trust Score** | Synthesizes an overall credibility score (0–100%) with categorized verdict tags and granular claim breakdowns. |

---

## 🚀 Quick Start (Run Locally)

### Option A: Run Unified Web App (Python Only — No Node.js Required)
The production React frontend is pre-built in `frontend/dist/`. You only need Python:

```bash
# 1. Clone repository
git clone https://github.com/Kritee-Chhabra/Factshield.git
cd Factshield

# 2. Install Python dependencies (Python 3.10+)
pip install -r requirements.txt

# 3. Start unified web server
python main.py
```
Open **[http://localhost:8000](http://localhost:8000)** in your browser!  
*The web interface, API endpoints (`/analyze`), and interactive Swagger docs (`/docs`) all run seamlessly on the same port.*

---

### Option B: Full Development Mode (FastAPI + React Vite HMR)

```bash
# Terminal 1 — Backend API
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8000 --reload

# Terminal 2 — React Frontend Dev Server
cd frontend
npm install
npm run dev
```
Open **[http://localhost:5173](http://localhost:5173)** for instant hot-module replacement during development.

---

## ☁️ Deploy 24/7 on the Web (Free)

FactShield is pre-configured for automated cloud deployment with zero headaches.

### 1. Deploy on Render.com (100% Free, Automated)
This repository includes a [`render.yaml`](./render.yaml) blueprint:

1. Fork or push this repository to your GitHub account.
2. Go to [render.com](https://render.com) and log in.
3. Click **New +** → **Web Service**.
4. Select your `Factshield` repository.
5. Render will automatically detect the settings:
   - **Environment**: `Python`
   - **Build Command**: `cd frontend && npm install && npm run build && cd .. && pip install -r requirements.txt`
   - **Start Command**: `uvicorn main:app --host 0.0.0.0 --port $PORT`
6. Click **Deploy Web Service** — in 2 minutes you get a permanent, free 24/7 HTTPS URL (e.g., `https://factshield.onrender.com`)!

---

### 2. Deploy via Docker (Railway / Hugging Face Spaces / Fly.io)
A multi-stage production [`Dockerfile`](./Dockerfile) is included:

* **Hugging Face Spaces**: Create a new Space, select the **Docker** SDK, push this repository, and it will deploy instantly with a permanent public link.
* **Railway**: Click **New Project** → **Deploy from GitHub repo**. Railway automatically detects the Dockerfile or [`Procfile`](./Procfile).
* **Fly.io**: Run `fly launch` in the project root.

---

## 🔌 API Documentation

When the server is running, explore the interactive OpenAPI documentation:

* **Swagger UI**: [http://localhost:8000/docs](http://localhost:8000/docs)
* **ReDoc**: [http://localhost:8000/redoc](http://localhost:8000/redoc)
* **Health Check**: `GET /api/health`

### Analyze Endpoint: `POST /analyze`

```bash
curl -X POST "http://localhost:8000/analyze" \
  -H "Content-Type: application/json" \
  -d '{"text": "According to the WHO, vaccines are proven to be safe and effective. In contrast, 99% of online claims are completely fabricated without proof."}'
```

Request limits: `text` up to `MAX_TEXT_LENGTH` characters (default 10,000; larger inputs return `422`).
An optional `sarvam_api_key` field switches the request to Sarvam AI; if that call fails, the heuristic engine is used and `engine.notice` explains why.

#### Sample Response (second claim omitted for brevity):
```json
{
  "overall_trust_score": 24.0,
  "summary": "Low trust. Multiple unverified, biased, or hallucinated claims detected. Analysed 2 claim(s): 0 verified, 0 unverified, 2 flagged.",
  "claims": [
    {
      "id": 1,
      "claim_text": "According to the WHO, vaccines are proven to be safe and effective.",
      "status": "Flagged",
      "confidence": 0.7,
      "reason": "Contains absolute or extreme certainty assertions typical of fabricated text. Includes verified source citation or documented evidence.",
      "flags": [
        "hallucination",
        "fact_verified"
      ],
      "dimensions": {
        "fact_check": "verified",
        "hallucination": "flagged",
        "bias": "clean",
        "emotional": "clean",
        "statistics": "clean"
      }
    }
  ],
  "metrics": {
    "fact_check": {
      "verified_count": 0,
      "debunked_count": 0,
      "neutral_count": 2,
      "score": 0.0
    },
    "hallucination": {
      "count": 2,
      "score": 0.0,
      "risk": "Severe"
    },
    "bias": {
      "detected": false,
      "count": 0,
      "score": 100.0,
      "level": "Neutral"
    },
    "emotional": {
      "score": 0.0,
      "count": 0,
      "intensity": "Calm / Objective"
    },
    "statistics": {
      "unverified_count": 1,
      "score": 50.0,
      "status": "Unverified Statistics"
    },
    "total_claims": 2
  },
  "scores": {
    "trust": 24.0,
    "fact_checking": 0.0,
    "hallucination": 0.0,
    "bias": 100.0,
    "emotional": 0.0,
    "statistics": 50.0
  },
  "engine": {
    "name": "Heuristic Engine",
    "model": "local",
    "credits_used": false
  }
}
```

Every engine (server heuristics, browser heuristics, Sarvam AI) returns this same shape.

---

## ⚙️ Configuration

All settings are optional environment variables (see [`.env.example`](./.env.example)):

| Variable | Default | Purpose |
|---|---|---|
| `SARVAM_API_KEY` | — | Server-side Sarvam AI key; enables LLM analysis for every request. |
| `SARVAM_MODEL` | `sarvam-105b` | Sarvam chat model. |
| `SARVAM_TIMEOUT` | `30` | Sarvam request timeout (seconds). |
| `CORS_ORIGINS` | `*` | Comma-separated allowed origins. |
| `MAX_TEXT_LENGTH` | `10000` | Maximum `/analyze` input length. |
| `VITE_API_BASE` (build time) | — | Point a statically hosted frontend at a remote backend. |

---

## 🧪 Tests

```bash
# Backend
pip install -r requirements-dev.txt
python -m pytest

# Frontend
cd frontend && npm ci && npm run lint && npm test
```

`tests/fixtures/engine_parity.json` is asserted by **both** test suites so the Python and browser engines stay identical.
CI ([`.github/workflows/ci.yml`](./.github/workflows/ci.yml)) runs all of the above on every push and pull request.

---

## 📁 Repository Structure

```
Factshield/
├── main.py                     # Unified FastAPI entry point (serves API & Web UI)
├── requirements.txt            # Python runtime dependencies
├── requirements-dev.txt        # + test dependencies
├── render.yaml / Procfile      # Render.com / Heroku / Railway deployment
├── Dockerfile                  # Multi-stage production container build
├── DEPLOYMENT.md               # Detailed web hosting guide
├── services/
│   ├── analyzer.py             # Heuristic audit engine + canonical report builder
│   └── sarvam_client.py        # Sarvam AI (LLM) client
├── tests/                      # pytest suite + shared engine parity fixture
└── frontend/                   # React + Vite client
    ├── vite.config.js          # Dev server with proxy to the FastAPI backend
    ├── dist/                   # Pre-compiled production build (served by main.py)
    └── src/
        ├── App.jsx             # Dashboard, 6 feature views, filters
        └── services/
            ├── localAnalyzer.js       # Browser engine (mirror of analyzer.py) + Sarvam direct call
            └── localAnalyzer.test.js  # node:test suite
```

> After changing anything in `frontend/src`, run `npm run build` so `frontend/dist` stays in sync for Python-only users.

---

## 🛡️ License

MIT License. Open-source and free to adapt for personal or enterprise AI auditing workflows.
