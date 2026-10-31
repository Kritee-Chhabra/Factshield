# FactShield 🛡️ — AI Hallucination & Bias Auditor

> **An advanced, multi-layer verification platform that audits AI-generated text (ChatGPT, Gemini, Claude) for hallucinations, biased framing, emotional manipulation, unverified statistics, and factual accuracy — producing an actionable Trust Score and granular claim-level breakdown.**

---

## 🌐 Live Web Demo

* **Live Demo URL**: [https://factshield-auditor.loca.lt](https://factshield-auditor.loca.lt)
* **First-Time Password**: `219.65.47.110`  
  *(Localtunnel displays a one-time anti-abuse prompt on your first visit from a new device; paste the IP above and click **"Click to Submit"** to enter the app).*

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

# 2. Install Python dependencies
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

#### Sample Response:
```json
{
  "overall_trust_score": 75.0,
  "summary": "Moderate trust. Some claims require independent verification.",
  "claims": [
    {
      "id": 1,
      "claim_text": "According to the WHO, vaccines are proven to be safe and effective.",
      "status": "Verified",
      "confidence": 0.95,
      "reason": "Includes credible citation or verified language — adds trustworthiness.",
      "flags": ["fact_verified"]
    },
    {
      "id": 2,
      "claim_text": "In contrast, 99% of online claims are completely fabricated without proof.",
      "status": "Flagged",
      "confidence": 0.40,
      "reason": "Contains absolute language. Statistical claim without a verifiable source citation.",
      "flags": ["hallucination", "unverified_stat"]
    }
  ],
  "metrics": {
    "fact_check": { "verified_count": 1, "debunked_count": 0, "neutral_count": 0 },
    "hallucination_count": 1,
    "bias_detected": false,
    "bias_count": 0,
    "emotional_manipulation_score": 0.0,
    "emotional_count": 0,
    "unverified_stats_count": 1,
    "total_claims": 2
  }
}
```

---

## 📁 Repository Structure

```
Factshield/
├── main.py                 # Unified FastAPI entry point (serves API & Web UI)
├── requirements.txt        # Python backend dependencies
├── render.yaml             # 1-click Render.com cloud deployment config
├── Procfile                # Heroku / Railway start script
├── Dockerfile              # Multi-stage production container build
├── DEPLOYMENT.md           # Detailed web hosting guide
├── services/
│   ├── __init__.py
│   └── analyzer.py         # Core heuristic audit engine (6 verification layers)
└── frontend/               # React + Vite client
    ├── index.html
    ├── package.json
    ├── vite.config.js      # Dev server with proxy to /analyze
    ├── dist/               # Pre-compiled static production assets
    └── src/
        ├── App.jsx         # Interactive dashboard, 6 feature buttons, live filters
        ├── App.css         # Classy dark graphite titanium & emerald design system
        └── index.css       # Core tokens & variables
```

---

## 🛡️ License

MIT License. Open-source and free to adapt for personal or enterprise AI auditing workflows.
