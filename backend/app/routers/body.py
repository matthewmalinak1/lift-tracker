"""The home screen: per-muscle recovery plus the latest WHOOP numbers."""

from datetime import date, timedelta

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import recovery
from ..db import get_session
from ..models import SplitDay, WhoopDaily, Workout
from ..queries import muscles_for, workouts_between
from ..schemas import BodyStatus, MuscleStatus, TodayPlan, WhoopBaseline, WhoopToday

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
        baseline=baseline(session, today),
        plan=plan(session, today, whoop.recovery_score if whoop and whoop.date == today else None),
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


BASELINE_DAYS = 30

SPLIT_NAMES = {
    SplitDay.chest_bi: "Chest / Bi",
    SplitDay.back_shoulder_tri: "Back / Shoulder / Tri",
    SplitDay.legs: "Legs",
}


def baseline(session: Session, today: date) -> WhoopBaseline | None:
    start = today - timedelta(days=BASELINE_DAYS)
    row = session.execute(
        select(
            func.count(WhoopDaily.id),
            func.avg(WhoopDaily.recovery_score),
            func.avg(WhoopDaily.hrv_rmssd_ms),
            func.avg(WhoopDaily.resting_hr),
            func.avg(WhoopDaily.sleep_hours),
        ).where(WhoopDaily.date >= start, WhoopDaily.date < today)
    ).one()
    n, rec, hrv, rhr, sleep = row
    if not n:
        return None

    def r(v: float | None) -> float | None:
        return None if v is None else round(float(v), 1)

    return WhoopBaseline(
        days=n, recovery_score=r(rec), hrv_rmssd_ms=r(hrv), resting_hr=r(rhr), sleep_hours=r(sleep)
    )


def zone(score: float | None) -> str | None:
    if score is None:
        return None
    return "green" if score >= 67 else "yellow" if score >= 34 else "red"


def plan(session: Session, today: date, recovery: float | None) -> TodayPlan:
    from .training import suggest_split  # local import avoids a cycle

    split = suggest_split(session, today)
    last = session.scalar(
        select(func.max(Workout.date)).where(Workout.split_day == split, Workout.date <= today)
    )
    z = zone(recovery)
    name = SPLIT_NAMES[split]
    if z == "green":
        msg = f"Recovery is green. A good day to push on {name}."
    elif z == "yellow":
        msg = f"Recovery is moderate. {name} as planned, nothing extra."
    elif z == "red":
        msg = f"Recovery is low. Consider a lighter {name} session or a rest day."
    else:
        msg = f"{name} is your most recovered split."
    return TodayPlan(suggested_split=split, last_trained=last, recovery_zone=z, message=msg)
