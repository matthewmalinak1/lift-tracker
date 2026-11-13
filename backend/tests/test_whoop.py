"""WHOOP connection and sync, against a fake WHOOP server (httpx.MockTransport)."""

from datetime import UTC, date, datetime, timedelta
from urllib.parse import parse_qs, urlparse

import httpx
import pytest
from sqlalchemy import select

from app import whoop
from app.db import SessionLocal
from app.models import WhoopDaily, WhoopToken


def cycle(cid, start, strain, steps=None, offset="-06:00"):
    c = {
        "id": cid,
        "start": start,
        "end": None,
        "timezone_offset": offset,
        "score_state": "SCORED",
        "score": {"strain": strain},
    }
    if steps is not None:
        c["step_count"] = steps
    return c


CYCLES = [
    # Fell asleep 10:30pm Nov 11 local -> the Nov 12 day
    cycle(101, "2025-11-12T04:30:00.000Z", 12.34, steps=9876),
    cycle(102, "2025-11-13T05:10:00.000Z", 8.0),
]
RECOVERIES = [
    {
        "cycle_id": 101,
        "sleep_id": "s1",
        "score_state": "SCORED",
        "score": {"recovery_score": 74, "resting_heart_rate": 52, "hrv_rmssd_milli": 88.456},
    },
    {"cycle_id": 102, "sleep_id": "s2", "score_state": "PENDING_SCORE", "score": None},
]
SLEEPS = [
    {
        "id": "s1",
        "start": "2025-11-12T04:30:00.000Z",
        "end": "2025-11-12T13:00:00.000Z",
        "timezone_offset": "-06:00",
        "nap": False,
        "score_state": "SCORED",
        "score": {
            "sleep_performance_percentage": 91,
            "stage_summary": {
                "total_in_bed_time_milli": 30_600_000,
                "total_awake_time_milli": 1_800_000,
                "total_no_data_time_milli": 0,
            },
        },
    },
    {
        "id": "nap",
        "start": "2025-11-12T21:00:00.000Z",
        "end": "2025-11-12T21:30:00.000Z",
        "timezone_offset": "-06:00",
        "nap": True,
        "score_state": "SCORED",
        "score": {},
    },
]


class FakeWhoop:
    def __init__(self):
        self.calls: list[tuple[str, dict]] = []
        self.refresh_count = 0
        self.token = "access-1"

    def handler(self, request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        if url.startswith(whoop.TOKEN_URL):
            form = parse_qs(request.content.decode())
            self.calls.append(("token", form))
            if form["grant_type"] == ["refresh_token"]:
                assert form["refresh_token"] == [f"refresh-{self.refresh_count + 1}"]
                assert form["scope"] == ["offline"]
                self.refresh_count += 1
            n = self.refresh_count + 1
            self.token = f"access-{n}"
            return httpx.Response(
                200,
                json={
                    "access_token": self.token,
                    "refresh_token": f"refresh-{n}",
                    "expires_in": 3600,
                    "scope": whoop.SCOPES,
                },
            )
        assert request.headers["Authorization"] == f"Bearer {self.token}"
        path = request.url.path
        params = dict(request.url.params)
        self.calls.append((path, params))
        data = {
            "/developer/v2/cycle": CYCLES,
            "/developer/v2/recovery": RECOVERIES,
            "/developer/v2/activity/sleep": SLEEPS,
        }[path]
        # Two pages, to exercise next_token
        if "nextToken" not in params:
            return httpx.Response(200, json={"records": data[:1], "next_token": "page2"})
        return httpx.Response(200, json={"records": data[1:], "next_token": None})


@pytest.fixture
def fake(monkeypatch):
    monkeypatch.setenv("WHOOP_CLIENT_ID", "cid")
    monkeypatch.setenv("WHOOP_CLIENT_SECRET", "csecret")
    f = FakeWhoop()
    monkeypatch.setattr(
        whoop, "client_factory", lambda: httpx.Client(transport=httpx.MockTransport(f.handler))
    )
    yield f
    with SessionLocal() as s:  # leave no connection behind for other tests
        whoop.disconnect(s)


def test_day_assignment():
    assert whoop.cycle_day(CYCLES[0]) == date(2025, 11, 12)
    assert whoop.sleep_day(SLEEPS[0]) == date(2025, 11, 12)  # woke 7:00 local
    assert whoop.sleep_hours(SLEEPS[0]["score"]) == 8.0  # 8.5h in bed - 0.5h awake


def test_state_is_signed_and_expires():
    s = whoop.make_state(now=1_000_000)
    assert whoop.check_state(s, now=1_000_100)
    assert not whoop.check_state(s, now=1_000_000 + 601)
    body, sig = s.split(".")
    assert not whoop.check_state(body + "." + sig[:-2] + "xx", now=1_000_100)
    assert not whoop.check_state("nonsense")


def test_status_when_not_configured(client, monkeypatch):
    monkeypatch.delenv("WHOOP_CLIENT_ID", raising=False)
    st = client.get("/api/whoop/status").json()
    assert st["configured"] is False and st["connected"] is False
    assert client.get("/api/whoop/connect", follow_redirects=False).status_code == 503


def test_connect_callback_and_sync(client, fake):
    r = client.get("/api/whoop/connect", follow_redirects=False)
    assert r.status_code == 302
    loc = urlparse(r.headers["location"])
    q = parse_qs(loc.query)
    assert loc.geturl().startswith(whoop.AUTH_URL)
    assert q["client_id"] == ["cid"]
    assert "offline" in q["scope"][0]
    assert q["redirect_uri"] == ["http://testserver/api/whoop/callback"]

    # A forged callback is refused
    bad = client.get(
        "/api/whoop/callback", params={"code": "c", "state": "forged"}, follow_redirects=False
    )
    assert bad.headers["location"] == "/?whoop=error"

    ok = client.get(
        "/api/whoop/callback",
        params={"code": "the-code", "state": q["state"][0]},
        follow_redirects=False,
    )
    assert ok.headers["location"] == "/?whoop=connected"
    token_call = next(c for c in fake.calls if c[0] == "token")
    assert token_call[1]["code"] == ["the-code"]
    assert token_call[1]["redirect_uri"] == ["http://testserver/api/whoop/callback"]

    with SessionLocal() as s:
        rows = {
            r.date: r
            for r in s.scalars(select(WhoopDaily).where(WhoopDaily.date >= date(2025, 11, 1)))
        }
    nov12 = rows[date(2025, 11, 12)]
    assert (nov12.recovery_score, nov12.resting_hr, nov12.hrv_rmssd_ms) == (74, 52, 88.5)
    assert (nov12.strain, nov12.steps) == (12.3, 9876)
    assert (nov12.sleep_hours, nov12.sleep_performance) == (8.0, 91)
    nov13 = rows[date(2025, 11, 13)]
    assert nov13.strain == 8.0 and nov13.recovery_score is None  # recovery not scored yet

    # Both pages were fetched for each collection
    assert sum(1 for c in fake.calls if c[0] == "/developer/v2/cycle") == 2

    st = client.get("/api/whoop/status").json()
    assert st["connected"] is True and st["last_sync_at"] is not None

    # The calendar day panel and body screen read the same data
    day = client.get("/api/day/2025-11-12").json()
    assert day["whoop"]["recovery_score"] == 74
    body = client.get("/api/body", params={"today": "2025-11-12"}).json()
    assert body["whoop"]["hrv_rmssd_ms"] == 88.5
    assert body["plan"]["recovery_zone"] == "green"  # 74% recovery
    assert body["plan"]["message"].startswith("Recovery is green")
    later = client.get("/api/body", params={"today": "2025-11-14"}).json()
    assert later["baseline"]["days"] == 2  # Nov 12 and 13 come before the 14th
    assert later["baseline"]["hrv_rmssd_ms"] == 88.5
    cal = client.get("/api/calendar", params={"year": 2025, "month": 11}).json()
    by_day = {w["date"]: w for w in cal["whoop"]}
    assert by_day["2025-11-12"]["recovery_score"] == 74


def test_expired_token_is_refreshed_and_rotated(client, fake):
    with SessionLocal() as s:
        s.add(
            WhoopToken(
                access_token="old",
                refresh_token="refresh-1",
                expires_at=datetime.now(UTC) - timedelta(minutes=5),
            )
        )
        s.commit()
    r = client.post("/api/whoop/sync")
    assert r.status_code == 200, r.text
    assert fake.refresh_count == 1
    with SessionLocal() as s:
        tok = s.scalars(select(WhoopToken)).one()
        assert tok.refresh_token == "refresh-2"  # the rotated token was saved


def test_sync_without_connection_is_a_clear_error(client, fake):
    r = client.post("/api/whoop/sync")
    assert r.status_code == 409
    assert "isn't connected" in r.json()["detail"]


def test_whoop_routes_require_login(anon):
    assert anon.get("/api/whoop/status").status_code == 401
    assert anon.get("/api/whoop/connect", follow_redirects=False).status_code == 401


def test_callback_works_without_app_cookie_but_needs_valid_state(anon, fake):
    # Simulates Safari returning from WHOOP without the home-screen app's cookie.
    state = whoop.make_state()
    cb = "/api/whoop/callback"
    r = anon.get(cb, params={"code": "c", "state": state}, follow_redirects=False)
    assert r.headers["location"] == "/?whoop=connected"
    r = anon.get(cb, params={"code": "c", "state": "x.y"}, follow_redirects=False)
    assert r.headers["location"] == "/?whoop=error"
