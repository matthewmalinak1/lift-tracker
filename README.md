# Lift Tracker

A personal strength-training tracker that runs as a home-screen web app on my phone. It logs every set, pulls daily recovery data from my WHOOP, and applies statistical models to measure how my strength changes over time and what drives it.

**Quant features (roadmap)**
- **Kalman filter** on estimated 1-rep max: separates true strength from day-to-day noise and reports a confidence band
- **Bayesian hierarchical model** of how recovery, HRV and sleep shift performance relative to that baseline
- **Fitness-fatigue (Banister) model** and **plateau detection**

The math is written up in [`docs/math/`](docs/math/README.md).

## Architecture

```mermaid
flowchart LR
    phone["Phone (installed web app)<br/>React + TypeScript"] -->|/api/*| api["FastAPI<br/>Vercel Python function"]
    api --> db[(Postgres<br/>Neon)]
    whoop["WHOOP API v2"] -->|daily sync, OAuth| api
    gha["GitHub Actions<br/>scheduled model fits"] -->|reads sets + WHOOP,<br/>writes estimates| db
```

| Layer | Tech | Why |
|---|---|---|
| Frontend | React, TypeScript, Vite, PWA, three.js | Installable on the home screen; caches the app shell for bad gym signal |
| API | Python, FastAPI, SQLAlchemy 2, Pydantic | Typed request validation; the same Python stack as the models |
| Database | Postgres (Neon free tier) | Relational data: workouts → sets → exercises |
| Models | NumPy / SciPy / PyMC (planned) | Run as scheduled jobs, not in the request path, so heavy libraries never slow the app |
| Hosting | Vercel | Static frontend + serverless Python from one repo, deployed on every push |

## Repo layout

```
api/index.py          Vercel entry point; exposes the FastAPI app
backend/app/          FastAPI app: config, db, models, schemas, auth
backend/app/routers/  API routes: training (log, calendar), body, progress, lab
backend/app/strength.py   e1RM, Kalman filter (MLE), plateau test
backend/app/recovery.py   muscle recovery model
backend/tests/        pytest suite
frontend/             React app (Vite)
docs/                 Architecture notes and math write-ups
scripts/              One-off utilities (icon generation, imports)
```

## Running locally (Windows)

Prerequisites: Git, Python 3.12+, Node.js LTS.

**Backend** (terminal 1, from the repo root):

```powershell
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements-dev.txt
cd backend
uvicorn app.main:app --reload --port 8000
```

With no `DATABASE_URL` set, it uses a local SQLite file, so no database setup is needed. Interactive API docs are at http://localhost:8000/docs.

**Frontend** (terminal 2):

```powershell
cd frontend
npm install
npm run dev
```

Open http://localhost:5173. The dev server forwards `/api` calls to the backend.

Copy `.env.example` to `.env` first; it holds the local login password (`dev-password`).

**Tests:** `cd backend` then `pytest`.

> If PowerShell blocks `Activate.ps1`, run `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` once.

## Deploying

1. Import the repo at vercel.com/new. `vercel.json` already defines the build, the Python function and the routing.
2. In the Vercel project, open **Storage → Create → Neon** (free). This sets `DATABASE_URL` automatically.
3. In **Settings → Environment Variables**, add `APP_PASSWORD` (the login password) and `SESSION_SECRET` (a random string, e.g. from `python -c "import secrets; print(secrets.token_urlsafe(32))"`).
4. Redeploy. Every push to `main` deploys again.
5. On the phone, open the site and choose **Add to Home Screen**.

## Security

Single-user login, drawn as a 3×3 pattern (sent as its keypad digits, e.g. a Z is `1235789`) or typed. The password exists only as a Vercel environment variable. A successful login sets an HttpOnly, SameSite=Lax cookie holding an HMAC-SHA256-signed token with a 1-day expiry, checked on every private route without any server-side session storage. Comparisons are constant-time, failed logins are delayed, and missing configuration fails closed. A 3×3 pattern has only ~390k possibilities, so a database-backed lockout after repeated failures is planned once the database is live. See [`backend/app/auth.py`](backend/app/auth.py).

## Roadmap

- [x] **Phase 0:** scaffold, data model, CI, deploy pipeline, installable app shell
- [x] **Home screen:** 3D holographic body (three.js, procedural mannequin, custom Fresnel shader, per-vertex muscle shading, drag to spin with momentum, tap a muscle; 2D fallback without WebGL); muscles shade red after training and fade over 3 days ([math](docs/math/muscle-recovery.md)); WHOOP stat panels
- [x] **Phase 1:** workout logging (+ Log button, last-time numbers, most-recovered split suggestion, draft saved on device), exercise library with muscle tags, green-day calendar with day detail and PRs, pattern-lock login
- [x] Walk-forward backtest of the strength filter on real history: band coverage, band width, error vs a naive forecast (Lab tab)
- [x] Import past workouts from an Excel template (`POST /api/import/xlsx`; preview with row-level errors, re-uploads never duplicate). The in-app button was removed after the one-time import.
- [x] Calendar heat map (green by sets, split tags, PR stars) and Progress grouped by muscle
- [ ] Offline set queue, DB-backed login lockout
- [ ] **Phase 2:** WHOOP OAuth and daily sync (recovery, HRV, sleep, strain, steps)
- [x] **Phase 3:** e1RM estimation and a Kalman filter with MLE-fitted noise and 95% bands ([math](docs/math/kalman-e1rm.md)); plateau detection; Lab tab
- [ ] **Phase 4:** Bayesian readiness model
- [ ] **Phase 5:** fitness-fatigue model and plateau detection
