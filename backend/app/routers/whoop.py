"""WHOOP connection routes.

All require the app login except the OAuth callback. On iPhone, a home-screen
app opens WHOOP's consent page in Safari, and Safari doesn't share the app's
login cookie, so the callback can arrive without a session. It is protected
instead by the signed, 10-minute `state`, which only a logged-in /connect
request can produce.
"""

import os
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import RedirectResponse
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import whoop
from ..db import get_session
from ..models import WhoopDaily, WhoopToken
from ..schemas import WhoopStatus, WhoopSyncResult

router = APIRouter(prefix="/whoop")
public_router = APIRouter(prefix="/api/whoop")


def redirect_uri(request: Request) -> str:
    """Must match the redirect URL registered in the WHOOP dashboard exactly."""
    configured = os.getenv("WHOOP_REDIRECT_URI")
    if configured:
        return configured
    host = request.headers.get("x-forwarded-host") or request.headers.get("host")
    proto = request.headers.get("x-forwarded-proto") or request.url.scheme
    return f"{proto}://{host}/api/whoop/callback"


@router.get("/status", response_model=WhoopStatus)
def status(session: Session = Depends(get_session)) -> WhoopStatus:
    tok = session.scalars(select(WhoopToken)).first()
    days = session.scalar(select(func.count(WhoopDaily.id))) or 0
    first = session.scalar(select(func.min(WhoopDaily.date)))
    return WhoopStatus(
        configured=whoop.configured(),
        connected=tok is not None,
        last_sync_at=whoop._aware(tok.last_sync_at) if tok and tok.last_sync_at else None,
        days_stored=days,
        first_day=first,
    )


@router.get("/connect")
def connect(request: Request) -> RedirectResponse:
    if not whoop.configured():
        raise HTTPException(503, "Add WHOOP_CLIENT_ID and WHOOP_CLIENT_SECRET in Vercel first")
    return RedirectResponse(whoop.authorize_url(redirect_uri(request)), status_code=302)


@public_router.get("/callback")
def callback(
    request: Request,
    code: str | None = Query(default=None),
    state: str | None = Query(default=None),
    error: str | None = Query(default=None),
    session: Session = Depends(get_session),
) -> RedirectResponse:
    if error or not code:
        return RedirectResponse("/?whoop=denied", status_code=302)
    if not state or not whoop.check_state(state):
        return RedirectResponse("/?whoop=error", status_code=302)
    try:
        whoop.exchange_code(session, code, redirect_uri(request))
        whoop.sync(session)
    except whoop.WhoopError:
        return RedirectResponse("/?whoop=error", status_code=302)
    return RedirectResponse("/?whoop=connected", status_code=302)


@router.post("/sync", response_model=WhoopSyncResult)
def sync_now(session: Session = Depends(get_session)) -> WhoopSyncResult:
    try:
        n = whoop.sync(session)
    except whoop.WhoopError as err:
        raise HTTPException(409, str(err)) from err
    return WhoopSyncResult(days_updated=n, synced_at=datetime.now(UTC))


@router.post("/disconnect", status_code=204)
def disconnect(session: Session = Depends(get_session)) -> None:
    whoop.disconnect(session)
