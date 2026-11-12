import os
import tempfile

import pytest

# Configure the app before it's imported: a throwaway SQLite file and test
# credentials (never real ones).
_tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)  # noqa: SIM115
_tmp.close()
os.environ["DATABASE_URL"] = f"sqlite:///{_tmp.name}"
os.environ["APP_PASSWORD"] = "test-password"
os.environ["SESSION_SECRET"] = "test-secret"
os.environ.pop("VERCEL", None)

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402


@pytest.fixture
def anon() -> TestClient:
    """A client with no session."""
    return TestClient(app)


@pytest.fixture
def client(anon: TestClient) -> TestClient:
    """A logged-in client."""
    r = anon.post("/api/auth/login", json={"password": "test-password"})
    assert r.status_code == 200
    return anon
