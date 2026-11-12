"""Single-user password login.

How it works
------------
* The password lives only in the `APP_PASSWORD` environment variable (set in
  Vercel's settings), never in the code or the database.
* A correct login returns a session token in an HttpOnly cookie, so page
  JavaScript can never read it. The token is
  `base64(payload).base64(HMAC-SHA256(SESSION_SECRET, payload))`, where the
  payload holds an expiry timestamp. The server can check a token without
  storing anything, which suits serverless functions that keep no state
  between requests.
* It fails closed: if either environment variable is missing, every login is
  refused, so a misconfigured deploy never leaves the data open.
"""

import base64
import hashlib
import hmac
import json
import os
import time

from fastapi import Cookie, HTTPException, Response, status

COOKIE_NAME = "session"
SESSION_DAYS = 90
SESSION_SECONDS = SESSION_DAYS * 24 * 60 * 60


def _password() -> str | None:
    return os.getenv("APP_PASSWORD") or None


def _secret() -> bytes | None:
    secret = os.getenv("SESSION_SECRET")
    return secret.encode() if secret else None


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _unb64(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def _sign(payload: bytes, secret: bytes) -> str:
    return _b64(hmac.new(secret, payload, hashlib.sha256).digest())


def auth_configured() -> bool:
    return _password() is not None and _secret() is not None


def check_password(candidate: str) -> bool:
    password = _password()
    if password is None or _secret() is None:
        return False
    # Constant-time comparison, so response timing can't reveal how many
    # leading characters of a guess were right.
    return hmac.compare_digest(candidate.encode(), password.encode())


def make_token(now: float | None = None) -> str:
    secret = _secret()
    if secret is None:
        raise RuntimeError("SESSION_SECRET is not set")
    issued = int(now if now is not None else time.time())
    payload = json.dumps({"exp": issued + SESSION_SECONDS}).encode()
    return f"{_b64(payload)}.{_sign(payload, secret)}"


def token_is_valid(token: str | None, now: float | None = None) -> bool:
    secret = _secret()
    if not token or secret is None:
        return False
    try:
        payload_b64, sig = token.split(".", 1)
        payload = _unb64(payload_b64)
        if not hmac.compare_digest(sig, _sign(payload, secret)):
            return False
        exp = json.loads(payload)["exp"]
    except (ValueError, KeyError, TypeError):
        return False
    return (now if now is not None else time.time()) < exp


def set_session_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        COOKIE_NAME,
        token,
        max_age=SESSION_SECONDS,
        httponly=True,
        # Vercel serves over HTTPS and sets VERCEL=1. Local dev runs over plain
        # http, where a Secure cookie would never be sent back.
        secure=bool(os.getenv("VERCEL")),
        samesite="lax",
        path="/",
    )


def clear_session_cookie(response: Response) -> None:
    response.delete_cookie(COOKIE_NAME, path="/")


def require_auth(session: str | None = Cookie(default=None)) -> None:
    """FastAPI dependency that guards every private route."""
    if not token_is_valid(session):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not logged in")
