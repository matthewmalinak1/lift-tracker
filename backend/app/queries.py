"""Database reads shared by several routers."""

from collections import defaultdict
from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from . import recovery
from .models import Set, Workout
from .strength import Obs, e1rm


def workouts_between(session: Session, start: date, end: date) -> list[Workout]:
    return list(
        session.scalars(
            select(Workout)
            .where(Workout.date.between(start, end))
            .options(selectinload(Workout.sets).selectinload(Set.exercise))
            .order_by(Workout.date, Workout.id)
        )
    )


def all_sets(session: Session) -> list[Set]:
    return list(
        session.scalars(
            select(Set)
            .join(Workout)
            .options(selectinload(Set.workout), selectinload(Set.exercise))
            .order_by(Workout.date, Set.id)
        )
    )


def session_bests(sets: list[Set]) -> dict[int, list[Obs]]:
    """Per exercise: one observation per training day, the day's best e1RM.

    Sets with no added weight (bodyweight work logged as 0) are skipped: their
    e1RM would be 0, which says nothing about strength. Tracking reps for those
    is a separate feature.
    """
    best: dict[tuple[int, date], float] = {}
    for s in sets:
        if s.weight <= 0:
            continue
        key = (s.exercise_id, s.workout.date)
        best[key] = max(best.get(key, 0.0), e1rm(s.weight, s.reps, s.rir))
    out: dict[int, list[Obs]] = defaultdict(list)
    for (ex_id, day), value in sorted(best.items(), key=lambda kv: kv[0][1]):
        out[ex_id].append(Obs(day, value))
    return out


def muscles_for(s: Set) -> list[recovery.Muscle]:
    tagged = [recovery.Muscle(m) for m in (s.exercise.muscles or [])]
    return tagged or recovery.DEFAULT_MUSCLES[s.workout.split_day]
