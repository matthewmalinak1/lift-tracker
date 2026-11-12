"""Database engine and session handling (SQLAlchemy 2.0)."""

from collections.abc import Iterator

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker
from sqlalchemy.pool import NullPool

from .config import settings


class Base(DeclarativeBase):
    pass


_is_sqlite = settings.database_url.startswith("sqlite")

if _is_sqlite:
    # SQLite needs this when FastAPI serves requests from several threads.
    engine = create_engine(
        settings.database_url, connect_args={"check_same_thread": False}
    )
else:
    # Serverless functions are short-lived, so holding a connection pool open
    # between invocations does more harm than good. Neon's pooled endpoint
    # does the pooling for us.
    engine = create_engine(settings.database_url, poolclass=NullPool)

SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


_schema_ready = False


def get_session() -> Iterator[Session]:
    """FastAPI dependency: one session per request, always closed.

    Tables are created on the first request that needs the database, not at
    startup, so routes that don't touch it (like login) keep working even if
    the database is unreachable.
    """
    global _schema_ready
    if not _schema_ready:
        init_db()
        _schema_ready = True
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


def init_db() -> None:
    """Create tables if they don't exist yet.

    Fine for Phase 0. Once the schema starts changing we'll switch to Alembic
    migrations so existing data is never dropped.
    """
    from . import models  # noqa: F401  (registers the tables on Base)

    Base.metadata.create_all(engine)
