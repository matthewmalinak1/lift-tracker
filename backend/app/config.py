"""App settings, read from environment variables.

Locally these come from a `.env` file (never committed). On Vercel they come
from the project's Environment Variables settings.
"""

import os
from dataclasses import dataclass

from dotenv import load_dotenv

load_dotenv()


def _normalize_db_url(url: str) -> str:
    """Point SQLAlchemy at the psycopg (v3) driver.

    Neon/Vercel hand out URLs that start with `postgres://` or `postgresql://`;
    SQLAlchemy needs `postgresql+psycopg://` to pick the right driver.
    """
    if url.startswith("postgres://"):
        url = "postgresql://" + url[len("postgres://"):]
    if url.startswith("postgresql://"):
        url = "postgresql+psycopg://" + url[len("postgresql://"):]
    return url


@dataclass(frozen=True)
class Settings:
    # Vercel's Neon integration sets DATABASE_URL (and POSTGRES_URL as an
    # alias). With neither set, fall back to a local SQLite file so the app
    # runs with zero setup.
    database_url: str = _normalize_db_url(
        os.getenv("DATABASE_URL") or os.getenv("POSTGRES_URL") or "sqlite:///./local.db"
    )
    weight_unit: str = os.getenv("WEIGHT_UNIT", "lb")


settings = Settings()
