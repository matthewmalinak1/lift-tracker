"""WHOOP API v2: OAuth connection and daily data sync.

Flow
----
1. /api/whoop/connect redirects to WHOOP's consent page with a signed,
   short-lived `state` (CSRF protection).
2. WHOOP redirects back to /api/whoop/callback with a code, which is exchanged
   for an access token plus a refresh token (`offline` scope).
3. sync() pulls cycles (strain, steps), recoveries (recovery %, HRV, resting
   HR) and sleeps (hours, performance) and upserts one WhoopDaily row per day.

Which day a WHOOP record belongs to
-----------------------------------
A WHOOP cycle starts when you fall asleep, so it often begins late the evening
before. A cycle is assigned to the local date of (start + 12 h), which lands on
the day you were awake for. Recoveries follow their cycle. A sleep is assigned
to the local date you woke up (its end). Naps are ignored.
"""

import base64
import hashlib
import hmac
import json
import os
import secrets
import time
from collections.abc import Callable
from datetime import UTC, date, datetime, timedelta, timezone
from urllib.parse import urlencode

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import WhoopDaily, WhoopToken

AUTH_URL = "https://api.prod.whoop.com/oauth/oauth2/auth"
TOKEN_URL = "https://api.prod.whoop.com/oauth/oauth2/token"
API = "https://api.prod.whoop.com/developer/v2"
SCOPES = "offline read:recovery read:cycles read:sleep read:profile"
FIRST_SYNC_DAYS = 120  # how far back the first sync reaches
RESYNC_OVERLAP_DAYS = 3  # re-pull recent days, since WHOOP finalises scores late
PAGE_LIMIT = 25  # WHOOP's maximum page size

# Tests swap this for a client backed by a fake WHOOP.
client_factory: Callable[[], httpx.Client] = lambda: httpx.Client(timeout=20)  # noqa: E731


class WhoopError(Exception):
    pass


# --- Config -----------------------------------------------------------------


def client_id() -> str | None:
    return os.getenv("WHOOP_CLIENT_ID") or None


def client_secret() -> str | None:
    return os.getenv("WHOOP_CLIENT_SECRET") or None


def configured() -> bool:
    return bool(client_id() and client_secret())


# --- OAuth state (signed, so a forged callback can't attach someone else's
#     WHOOP account) ----------------------------------------------------------


def _b64(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


def _secret() -> bytes:
    s = os.getenv("SESSION_SECRET")
    if not s:
        raise WhoopError("SESSION_SECRET is not set")
    return s.encode()


def make_state(now: float | None = None) -> str:
    payload = json.dumps({"exp": int((now or time.time()) + 600), "n": secrets.token_hex(8)})
    body = _b64(payload.encode())
    sig = _b64(hmac.new(_secret(), b"whoop-state:" + body.encode(), hashlib.sha256).digest())
    return f"{body}.{sig}"


def check_state(state: str, now: float | None = None) -> bool:
    try:
        body, sig = state.split(".", 1)
        want = _b64(hmac.new(_secret(), b"whoop-state:" + body.encode(), hashlib.sha256).digest())
        if not hmac.compare_digest(sig, want):
            return False
        payload = json.loads(base64.urlsafe_b64decode(body + "=" * (-len(body) % 4)))
        return (now or time.time()) < payload["exp"]
    except (ValueError, KeyError, TypeError):
        return False


def authorize_url(redirect_uri: str) -> str:
    return AUTH_URL + "?" + urlencode(
        {
            "response_type": "code",
            "client_id": client_id(),
            "redirect_uri": redirect_uri,
            "scope": SCOPES,
            "state": make_state(),
        }
    )


# --- Tokens -----------------------------------------------------------------


def _save_tokens(session: Session, data: dict) -> WhoopToken:
    tok = session.scalars(select(WhoopToken)).first() or WhoopToken()
    tok.access_token = data["access_token"]
    # WHOOP rotates refresh tokens; keep the old one only if none came back.
    tok.refresh_token = data.get("refresh_token") or tok.refresh_token
    tok.expires_at = datetime.now(UTC) + timedelta(seconds=int(data.get("expires_in", 3600)))
    tok.scope = data.get("scope", tok.scope)
    session.add(tok)
    session.commit()
    return tok


def exchange_code(session: Session, code: str, redirect_uri: str) -> WhoopToken:
    with client_factory() as c:
        r = c.post(
            TOKEN_URL,
            data={
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": redirect_uri,
                "client_id": client_id(),
                "client_secret": client_secret(),
            },
        )
    if r.status_code != 200:
        raise WhoopError(f"WHOOP rejected the login ({r.status_code})")
    tok = _save_tokens(session, r.json())
    tok.connected_at = datetime.now(UTC)
    tok.last_sync_at = None
    session.commit()
    return tok


def _aware(dt: datetime) -> datetime:
    # SQLite hands datetimes back without a timezone; they were stored as UTC.
    return dt if dt.tzinfo else dt.replace(tzinfo=UTC)


def access_token(session: Session) -> str:
    tok = session.scalars(select(WhoopToken)).first()
    if tok is None:
        raise WhoopError("WHOOP isn't connected")
    if _aware(tok.expires_at) > datetime.now(UTC) + timedelta(seconds=60):
        return tok.access_token
    if not tok.refresh_token:
        raise WhoopError("WHOOP session expired; connect again")
    with client_factory() as c:
        r = c.post(
            TOKEN_URL,
            data={
                "grant_type": "refresh_token",
                "refresh_token": tok.refresh_token,
                "client_id": client_id(),
                "client_secret": client_secret(),
                "scope": "offline",
            },
        )
    if r.status_code != 200:
        raise WhoopError("WHOOP session expired; connect again")
    return _save_tokens(session, r.json()).access_token


# --- Fetching ---------------------------------------------------------------


def _iso(dt: datetime) -> str:
    return dt.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%S.000Z")


def _get_all(c: httpx.Client, token: str, path: str, start: datetime, end: datetime) -> list[dict]:
    out: list[dict] = []
    params: dict[str, str | int] = {"start": _iso(start), "end": _iso(end), "limit": PAGE_LIMIT}
    for _ in range(200):  # hard stop; 200 pages x 25 = 5000 records
        r = c.get(f"{API}{path}", params=params, headers={"Authorization": f"Bearer {token}"})
        if r.status_code == 401:
            raise WhoopError("WHOOP session expired; connect again")
        if r.status_code != 200:
            raise WhoopError(f"WHOOP returned {r.status_code} for {path}")
        body = r.json()
        out.extend(body.get("records", []))
        nxt = body.get("next_token")
        if not nxt:
            break
        params["nextToken"] = nxt
    return out


def _parse_dt(s: str) -> datetime:
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def _local(s: str, offset: str | None) -> datetime:
    dt = _parse_dt(s)
    if offset:
        sign = -1 if offset.startswith("-") else 1
        hh, mm = offset.lstrip("+-").split(":")
        dt = dt.astimezone(timezone(sign * timedelta(hours=int(hh), minutes=int(mm))))
    return dt


def cycle_day(cycle: dict) -> date:
    return (_local(cycle["start"], cycle.get("timezone_offset")) + timedelta(hours=12)).date()


def sleep_day(sleep: dict) -> date:
    return _local(sleep["end"], sleep.get("timezone_offset")).date()


def sleep_hours(score: dict) -> float | None:
    st = score.get("stage_summary") or {}
    in_bed = st.get("total_in_bed_time_milli")
    if in_bed is None:
        return None
    awake = (st.get("total_awake_time_milli") or 0) + (st.get("total_no_data_time_milli") or 0)
    asleep = in_bed - awake
    return round(max(asleep, 0) / 3_600_000, 2)


def build_days(cycles: list[dict], recoveries: list[dict], sleeps: list[dict]) -> dict[date, dict]:
    """Merge WHOOP records into one dict of fields per day."""
    days: dict[date, dict] = {}
    cycle_dates: dict[object, date] = {}

    for cy in cycles:
        if not cy.get("start"):
            continue
        d = cycle_day(cy)
        cycle_dates[cy.get("id")] = d
        row = days.setdefault(d, {"raw": {}})
        score = cy.get("score") or {}
        if cy.get("score_state") == "SCORED" and score.get("strain") is not None:
            row["strain"] = round(float(score["strain"]), 1)
        steps = cy.get("step_count", score.get("step_count"))
        if steps is not None:
            row["steps"] = int(steps)
        row["raw"]["cycle"] = cy

    for rec in recoveries:
        d = cycle_dates.get(rec.get("cycle_id"))
        score = rec.get("score") or {}
        if d is None or rec.get("score_state") != "SCORED":
            continue
        row = days.setdefault(d, {"raw": {}})
        row["recovery_score"] = score.get("recovery_score")
        row["resting_hr"] = score.get("resting_heart_rate")
        hrv = score.get("hrv_rmssd_milli")
        row["hrv_rmssd_ms"] = None if hrv is None else round(float(hrv), 1)
        row["raw"]["recovery"] = rec

    for sl in sleeps:
        if sl.get("nap") or sl.get("score_state") != "SCORED" or not sl.get("end"):
            continue
        d = sleep_day(sl)
        score = sl.get("score") or {}
        row = days.setdefault(d, {"raw": {}})
        row["sleep_hours"] = sleep_hours(score)
        row["sleep_performance"] = score.get("sleep_performance_percentage")
        row["raw"]["sleep"] = sl
    return days


FIELDS = (
    "recovery_score",
    "hrv_rmssd_ms",
    "resting_hr",
    "sleep_hours",
    "sleep_performance",
    "strain",
    "steps",
)


def sync(session: Session, now: datetime | None = None) -> int:
    """Pull new WHOOP data; returns the number of days written."""
    now = now or datetime.now(UTC)
    token = access_token(session)
    tok = session.scalars(select(WhoopToken)).first()
    assert tok is not None
    if tok.last_sync_at:
        start = _aware(tok.last_sync_at) - timedelta(days=RESYNC_OVERLAP_DAYS)
    else:
        start = now - timedelta(days=FIRST_SYNC_DAYS)

    with client_factory() as c:
        cycles = _get_all(c, token, "/cycle", start, now)
        recoveries = _get_all(c, token, "/recovery", start, now)
        sleeps = _get_all(c, token, "/activity/sleep", start, now)

    days = build_days(cycles, recoveries, sleeps)
    existing = {
        r.date: r
        for r in session.scalars(select(WhoopDaily).where(WhoopDaily.date.in_(list(days))))
    }
    for d, fields in days.items():
        row = existing.get(d) or WhoopDaily(date=d)
        for k in FIELDS:
            if k in fields:
                setattr(row, k, fields[k])
        row.raw = {**(row.raw or {}), **fields["raw"]}
        row.synced_at = now
        session.add(row)
    tok.last_sync_at = now
    session.commit()
    return len(days)


def disconnect(session: Session) -> None:
    tok = session.scalars(select(WhoopToken)).first()
    if tok:
        session.delete(tok)
        session.commit()
