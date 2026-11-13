"""FastAPI application: every backend route lives under /api."""

import asyncio

from fastapi import APIRouter, Cookie, Depends, FastAPI, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from . import auth
from .db import engine
from .routers import body, imports, lab, progress, training, whoop
from .routers import health as health_routes
from .schemas import Health, LoginIn, Me

app = FastAPI(title="Lift Tracker API", version="0.3.0")

# Local dev only: the Vite dev server runs on :5173 and calls the API on :8000.
# In production the frontend and API share one domain, so CORS doesn't apply.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
    allow_credentials=True,
)



@app.get("/api/health", response_model=Health)
def health() -> Health:
    """Public status check. Reports the database without exposing any data."""
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        db_status = "ok"
    except Exception:  # noqa: BLE001 - any failure means "unreachable"
        db_status = "unreachable"
    return Health(status="ok", database=db_status)


# --- Auth (public) ----------------------------------------------------------


@app.post("/api/auth/login", response_model=Me)
async def login(body: LoginIn, response: Response) -> Me:
    if not auth.auth_configured():
        # Still refuses the login (fails closed), but says why, so a missing
        # environment variable isn't mistaken for a wrong password.
        missing = " and ".join(auth.missing_settings())
        raise HTTPException(503, f"Login isn't set up on the server yet: {missing} is missing")
    if not auth.check_password(body.password):
        # Slow down repeated guessing.
        await asyncio.sleep(1)
        raise HTTPException(401, "Wrong password")
    auth.set_session_cookie(response, auth.make_token())
    return Me(logged_in=True)


@app.post("/api/auth/logout", response_model=Me)
def logout(response: Response) -> Me:
    auth.clear_session_cookie(response)
    return Me(logged_in=False)


@app.get("/api/auth/me", response_model=Me)
def me(session: str | None = Cookie(default=None)) -> Me:
    return Me(logged_in=auth.token_is_valid(session))


# --- Private routes (need a valid session) ------------------------------------

# Every route on this router requires a valid session cookie.
private = APIRouter(prefix="/api", dependencies=[Depends(auth.require_auth)])
for r in (
    training.router,
    body.router,
    progress.router,
    lab.router,
    imports.router,
    whoop.router,
    health_routes.router,
):
    private.include_router(r)

app.include_router(private)
app.include_router(whoop.public_router)  # OAuth callback: guarded by the signed state
