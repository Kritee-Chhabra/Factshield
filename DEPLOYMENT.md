# FactShield — Web Deployment Guide

This guide shows how to share FactShield with anyone on the web.

---

## ⚡ Option 1: Instant Live Public Link (Active Right Now!)

FactShield is currently being tunneled to a public HTTPS URL:

* **Public Web Link**: [https://factshield-auditor.loca.lt](https://factshield-auditor.loca.lt)
* **First-Time Password**: `219.65.47.110`  
  *(Localtunnel displays a one-time anti-abuse prompt on first visit; simply enter the IP address above and click "Click to Submit" to view the app).*

Anyone on a phone, tablet, or another computer can open this link and use FactShield immediately!

---

## 🌐 Option 2: Permanent 24/7 Free Cloud Hosting (Recommended)

To keep FactShield online 24/7 even when your PC is turned off, deploy it to a free cloud hosting provider:

### A. Deploy to Render.com (100% Free, Automated)
1. Push this folder to a GitHub repository:
   ```bash
   git init
   git add .
   git commit -m "Initial FactShield commit"
   git branch -M main
   git remote add origin https://github.com/<your-username>/factshield.git
   git push -u origin main
   ```
2. Go to [render.com](https://render.com) and click **New +** → **Web Service**.
3. Connect your GitHub repository.
4. Set the following settings:
   - **Environment**: `Python`
   - **Build Command**: `cd frontend && npm install && npm run build && cd .. && pip install -r requirements.txt`
   - **Start Command**: `uvicorn main:app --host 0.0.0.0 --port $PORT`
5. Click **Create Web Service**. Render will give you a permanent URL like `https://factshield.onrender.com`.

---

### B. Deploy via Docker (Railway, Fly.io, or Hugging Face Spaces)
The repository includes a production multi-stage [Dockerfile](file:///c:/Users/V5%20IT%20SOLUTION/Desktop/backend/Dockerfile):
* **Hugging Face Spaces**: Create a new Space with the `Docker` SDK, push this repo, and it automatically deploys with a free, persistent HTTPS URL!
* **Railway**: Click "New Project" → "Deploy from GitHub repo". Railway detects the `Dockerfile` or `Procfile` and deploys automatically.
* **Fly.io**: Run `fly launch` in this directory.

---

## 🛠️ Architecture Summary for Web

* **Unified Serving**: [main.py](file:///c:/Users/V5%20IT%20SOLUTION/Desktop/backend/main.py) automatically serves both the compiled React frontend (`/`) and the API (`/analyze`, `/docs`, `/api/health`) from a single process and port.
* **Relative Endpoints**: The frontend connects via relative paths (`/analyze`), eliminating CORS configuration and port mismatches.
* **Dynamic Binding**: Reads `HOST` and `PORT` environment variables to seamlessly adapt to any cloud container or hosting environment.
