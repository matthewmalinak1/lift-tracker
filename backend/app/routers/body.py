"""The home screen: per-muscle recovery plus the latest WHOOP numbers."""

from datetime import date, timedelta

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import recovery
from ..db import get_session
from ..models import WhoopDaily, Workout
from ..queries import muscles_for, workouts_between
from ..schemas import BodyStatus, MuscleStatus, WhoopToday

router = APIRouter()


def _hits_for(workout: Workout) -> list[recovery.Hit]:
    if not workout.sets:
        # No set detail: count the split's main muscles as fully hit.
        defaults = recovery.DEFAULT_MUSCLES[workout.split_day]
        return [recovery.Hit(m, workout.date, None) for m in defaults]
    return [recovery.Hit(m, workout.date, 1) for s in workout.sets for m in muscles_for(s)]


def muscle_states_for(session: Session, today: date) -> dict[recovery.Muscle, recovery.MuscleState]:
    since = today - timedelta(days=recovery.RECOVERY_DAYS)
    hits = [h for w in workouts_between(session, since, today) for h in _hits_for(w)]
    return recovery.muscle_states(hits, today)


@router.get("/body", response_model=BodyStatus)
def body_status(
    today: date | None = Query(
        default=None, description="The phone's local date, so 'today' matches the user's day"
    ),
    session: Session = Depends(get_session),
) -> BodyStatus:
    """Per-muscle recovery for the body heat map, plus the latest WHOOP numbers."""
    today = today or date.today()
    states = muscle_states_for(session, today)
    whoop = session.scalars(
        select(WhoopDaily).where(WhoopDaily.date <= today).order_by(WhoopDaily.date.desc())
    ).first()

    return BodyStatus(
        today=today,
        recovery_days=recovery.RECOVERY_DAYS,
        muscles={
            m: MuscleStatus(
                fatigue=st.fatigue, last_trained=st.last_trained, days_since=st.days_since
            )
            for m, st in states.items()
        },
        whoop=WhoopToday.model_validate(whoop) if whoop else None,
    )
