import pytest

from app import auth


def test_private_routes_require_login(anon):
    assert anon.get("/api/exercises").status_code == 401
    assert anon.get("/api/workouts", params={"year": 2026, "month": 11}).status_code == 401
    assert anon.get("/api/auth/me").json() == {"logged_in": False}


def test_wrong_password_is_rejected(anon):
    r = anon.post("/api/auth/login", json={"password": "nope"})
    assert r.status_code == 401
    assert "session" not in r.cookies
    assert anon.get("/api/exercises").status_code == 401


def test_login_then_logout(client):
    assert client.get("/api/auth/me").json() == {"logged_in": True}
    assert client.get("/api/exercises").status_code == 200

    client.post("/api/auth/logout")
    assert client.get("/api/auth/me").json() == {"logged_in": False}
    assert client.get("/api/exercises").status_code == 401


def test_session_cookie_is_httponly(anon):
    r = anon.post("/api/auth/login", json={"password": "test-password"})
    set_cookie = r.headers["set-cookie"].lower()
    assert "httponly" in set_cookie
    assert "samesite=lax" in set_cookie


def test_tampered_token_is_rejected():
    token = auth.make_token()
    payload, sig = token.split(".")
    forged = auth.make_token(now=10**10).split(".")[0]  # far-future expiry
    assert auth.token_is_valid(token)
    assert not auth.token_is_valid(f"{forged}.{sig}")  # payload swapped, old signature
    assert not auth.token_is_valid(f"{payload}.{sig[:-2]}xx")
    assert not auth.token_is_valid("garbage")
    assert not auth.token_is_valid("")


def test_token_expires():
    token = auth.make_token(now=1_000_000)
    assert auth.token_is_valid(token, now=1_000_000 + auth.SESSION_SECONDS - 1)
    assert not auth.token_is_valid(token, now=1_000_000 + auth.SESSION_SECONDS + 1)


@pytest.mark.parametrize("missing", ["APP_PASSWORD", "SESSION_SECRET"])
def test_fails_closed_when_not_configured(anon, monkeypatch, missing):
    monkeypatch.delenv(missing)
    r = anon.post("/api/auth/login", json={"password": "test-password"})
    assert r.status_code == 503
    assert missing in r.json()["detail"]
    assert "session" not in r.cookies
