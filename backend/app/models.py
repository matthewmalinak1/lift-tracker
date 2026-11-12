"""Database tables.

Design notes
------------
* A **Workout** is one gym session on one date. Each session is one of the
  three split days.
* A **Set** belongs to a workout and an exercise. We store raw weight × reps
  plus optional reps-in-reserve (RIR). Everything else (estimated 1RM,
  Kalman-filtered strength, etc.) is *derived* and computed from these rows,
  never typed in.
* **Exercise** names come from a fixed list so one lift's history never gets
  split across spellings.
* **WhoopDaily** holds one row per day of WHOOP data, plus the raw JSON so we
  can re-derive fields later without re-calling the API.
"""

import enum
from datetime import UTC, date, datetime

from sqlalchemy import (
    JSON,
    Date,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


def _utcnow() -> datetime:
    return datetime.now(UTC)


class SplitDay(enum.StrEnum):
    chest_bi = "chest_bi"
    back_shoulder_tri = "back_shoulder_tri"
    legs = "legs"


class Exercise(Base):
    __tablename__ = "exercises"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(80), unique=True)
    split_day: Mapped[SplitDay] = mapped_column(Enum(SplitDay))
    # Free text like "barbell", "dumbbell", "machine", "cable".
    equipment: Mapped[str | None] = mapped_column(String(40))
    active: Mapped[bool] = mapped_column(default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)


class Workout(Base):
    __tablename__ = "workouts"

    id: Mapped[int] = mapped_column(primary_key=True)
    date: Mapped[date] = mapped_column(Date, index=True)
    split_day: Mapped[SplitDay] = mapped_column(Enum(SplitDay))
    notes: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)

    sets: Mapped[list["Set"]] = relationship(
        back_populates="workout", cascade="all, delete-orphan", order_by="Set.id"
    )


class Set(Base):
    __tablename__ = "sets"

    id: Mapped[int] = mapped_column(primary_key=True)
    workout_id: Mapped[int] = mapped_column(ForeignKey("workouts.id", ondelete="CASCADE"))
    exercise_id: Mapped[int] = mapped_column(ForeignKey("exercises.id"))
    set_number: Mapped[int] = mapped_column(Integer)  # 1 or 2 for this split
    weight: Mapped[float] = mapped_column(Float)  # in settings.weight_unit
    reps: Mapped[int] = mapped_column(Integer)
    rir: Mapped[int | None] = mapped_column(Integer)  # reps in reserve, 0 = failure

    workout: Mapped[Workout] = relationship(back_populates="sets")
    exercise: Mapped[Exercise] = relationship()


class BodyWeight(Base):
    __tablename__ = "body_weight"

    id: Mapped[int] = mapped_column(primary_key=True)
    date: Mapped[date] = mapped_column(Date, unique=True)
    weight: Mapped[float] = mapped_column(Float)


class WhoopDaily(Base):
    """One row per WHOOP physiological cycle (roughly one per day)."""

    __tablename__ = "whoop_daily"
    __table_args__ = (UniqueConstraint("date", name="uq_whoop_daily_date"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    date: Mapped[date] = mapped_column(Date, index=True)
    recovery_score: Mapped[float | None] = mapped_column(Float)  # 0-100
    hrv_rmssd_ms: Mapped[float | None] = mapped_column(Float)
    resting_hr: Mapped[float | None] = mapped_column(Float)
    sleep_performance: Mapped[float | None] = mapped_column(Float)  # 0-100
    sleep_hours: Mapped[float | None] = mapped_column(Float)
    strain: Mapped[float | None] = mapped_column(Float)  # 0-21
    steps: Mapped[int | None] = mapped_column(Integer)
    raw: Mapped[dict | None] = mapped_column(JSON)
    synced_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
