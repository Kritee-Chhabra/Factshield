# FactShield — Frontend

React 19 + Vite client for FactShield. See the [project README](../README.md) for the full overview.

```bash
npm ci
npm run dev     # http://localhost:5173 (proxies /analyze, /docs, /redoc to http://127.0.0.1:8000)
npm run lint
npm test        # node:test — includes Python/browser engine parity checks
npm run build   # outputs dist/ (served by ../main.py and deployed to GitHub Pages)
```

`src/services/localAnalyzer.js` is a JavaScript port of `services/analyzer.py` used when no backend is
available (e.g. GitHub Pages). Keep the two in sync — the shared fixture in `../tests/fixtures/` enforces it.
