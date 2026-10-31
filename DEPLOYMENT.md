# FactShield — Web Deployment Guide

This guide shows how to share FactShield with anyone on the web.

---

## ⚡ Option 1: GitHub Pages (Static, Browser Mode)

Pushing to `main` runs [`.github/workflows/deploy.yml`](./.github/workflows/deploy.yml), which lints, tests and builds
`frontend/` and publishes it to GitHub Pages (enable **Settings → Pages → Source: GitHub Actions** once).

Without a backend the app runs the heuristic engine in the browser. To use a hosted backend instead,
set the `VITE_API_BASE` environment variable (e.g. `https://factshield.onrender.com`) for the build step
and add your Pages origin to the backend's `CORS_ORIGINS`.

For a quick temporary public link to a local server you can also use a tunnel such as
`npx localtunnel --port 8000` or `cloudflared tunnel --url http://localhost:8000`.

---

## 🌐 Option 2: Full-Stack 24/7 Cloud Hosting (Recommended)

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
   - **Build Command**: `cd frontend && npm ci && npm run build && cd .. && pip install -r requirements.txt`
   - **Start Command**: `uvicorn main:app --host 0.0.0.0 --port $PORT`
5. Optionally add a `SARVAM_API_KEY` environment variable to enable Sarvam AI analysis server-side.
6. Click **Create Web Service**. Render will give you a permanent URL like `https://factshield.onrender.com`.

---

### B. Deploy via Docker (Railway, Fly.io, or Hugging Face Spaces)
The repository includes a production multi-stage [Dockerfile](./Dockerfile):
* **Hugging Face Spaces**: Create a new Space with the `Docker` SDK, push this repo, and it automatically deploys with a free, persistent HTTPS URL!
* **Railway**: Click "New Project" → "Deploy from GitHub repo". Railway detects the `Dockerfile` or `Procfile` and deploys automatically.
* **Fly.io**: Run `fly launch` in this directory.

---

## 🛠️ Architecture Summary for Web

* **Unified Serving**: [main.py](./main.py) automatically serves both the compiled React frontend (`/`) and the API (`/analyze`, `/docs`, `/api/health`) from a single process and port.
* **Relative Endpoints**: The frontend connects via relative paths (`/analyze`), eliminating CORS configuration and port mismatches.
* **Graceful Degradation**: If the backend is unreachable, the frontend runs the same heuristic engine client-side.
* **Configuration**: See the *Configuration* table in the [README](./README.md#️-configuration) and [`.env.example`](./.env.example).
* **Dynamic Binding**: Reads `HOST` and `PORT` environment variables to seamlessly adapt to any cloud container or hosting environment.
