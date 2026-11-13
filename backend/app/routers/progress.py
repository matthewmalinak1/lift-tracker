"""Strength progress: per-lift Kalman-filtered e1RM, PRs and weekly volume."""

from collections import defaultdict
from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import recovery
from ..config import settings
from ..db import get_session
from ..models import Exercise
from ..queries import all_sets, muscles_for, session_bests, workouts_between
from ..schemas import LiftProgress, LiftSummary, SeriesPoint, TrendOut, VolumeWeek
from ..strength import Trend, fit_kalman, trend

router = APIRouter(prefix="/progress")


@router.get("/lifts", response_model=list[LiftSummary])
def lifts(
    today: date | None = Query(default=None), session: Session = Depends(get_session)
) -> list[LiftSummary]:
    """Every exercise with weighted sets, most-trained first, with the muscle
    it's grouped under on the Progress tab."""
    today = today or date.today()
    bests = session_bests(all_sets(session))
    exercises = {e.id: e for e in session.scalars(select(Exercise))}
    out = []
    for ex_id, obs in bests.items():
        fit = fit_kalman(obs)
        e = exercises[ex_id]
        muscles = [recovery.Muscle(m) for m in e.muscles or []]
        primary = muscles[0] if muscles else recovery.DEFAULT_MUSCLES[e.split_day][0]
        out.append(
            LiftSummary(
                exercise_id=ex_id,
                name=e.name,
                split_day=e.split_day,
                muscles=muscles,
                primary_muscle=primary,
                sessions=len(obs),
                best_e1rm=round(max(o.value for o in obs), 1),
                current_estimate=round(fit.points[-1].mean, 1),
                trend=trend(obs, today).status,
            )
        )
    # Most-trained first; among equals, heavier (usually compound) lifts first.
    out.sort(key=lambda lift: (-lift.sessions, -(lift.best_e1rm or 0), lift.name))
    return out


def _r(v: float | None) -> float | None:
    return None if v is None else round(v, 2)


def trend_out(t: Trend) -> TrendOut:
    r = _r
    return TrendOut(
        status=t.status,
        pct_per_week=r(t.pct_per_week),
        ci_low=r(t.ci_low),
        ci_high=r(t.ci_high),
        sessions=t.sessions,
        window_days=t.window_days,
    )


@router.get("/lift/{exercise_id}", response_model=LiftProgress)
def lift_progress(
    exercise_id: int,
    today: date | None = Query(default=None),
    session: Session = Depends(get_session),
) -> LiftProgress:
    today = today or date.today()
    exercise = session.get(Exercise, exercise_id)
    if exercise is None:
        raise HTTPException(404, "Exercise not found")

    sets = [s for s in all_sets(session) if s.exercise_id == exercise_id]
    obs = session_bests(sets).get(exercise_id, [])
    empty = LiftProgress(
        exercise_id=exercise_id, name=exercise.name, unit=settings.weight_unit, series=[],
        today_estimate=None, today_lower=None, today_upper=None, fitted=False,
        noise_pct=None, drift_pct_per_week=None, best_e1rm=None, best_e1rm_date=None,
        heaviest_weight=None, heaviest_weight_date=None,
        trend=trend_out(trend([], today)),
    )
    if not obs:
        return empty

    fit = fit_kalman(obs)
    est, sd = fit.predict(today)
    best = max(obs, key=lambda o: o.value)
    heaviest = max(sets, key=lambda s: (s.weight, -s.workout.date.toordinal()))

    return LiftProgress(
        exercise_id=exercise_id,
        name=exercise.name,
        unit=settings.weight_unit,
        series=[
            SeriesPoint(
                date=p.day,
                observed=round(p.observed, 1),
                estimate=round(p.mean, 1),
                lower=round(p.lower, 1),
                upper=round(p.upper, 1),
            )
            for p in fit.points
        ],
        today_estimate=round(est, 1),
        today_lower=round(est - 1.96 * sd, 1),
        today_upper=round(est + 1.96 * sd, 1),
        fitted=fit.fitted,
        noise_pct=round(fit.noise_pct, 2),
        drift_pct_per_week=round(fit.drift_pct_per_week, 2),
        best_e1rm=round(best.value, 1),
        best_e1rm_date=best.day,
        heaviest_weight=heaviest.weight,
        heaviest_weight_date=heaviest.workout.date,
        trend=trend_out(trend(obs, today)),
    )


@router.get("/volume", response_model=list[VolumeWeek])
def weekly_volume(
    today: date | None = Query(default=None),
    weeks: int = Query(default=4, ge=1, le=26),
    session: Session = Depends(get_session),
) -> list[VolumeWeek]:
    """Sets per muscle per week (Mon-Sun), oldest week first."""
    today = today or date.today()
    this_monday = today - timedelta(days=today.weekday())
    first_monday = this_monday - timedelta(weeks=weeks - 1)

    counts: dict[date, dict[recovery.Muscle, int]] = {
        first_monday + timedelta(weeks=i): defaultdict(int) for i in range(weeks)
    }
    for w in workouts_between(session, first_monday, today):
        monday = w.date - timedelta(days=w.date.weekday())
        for s in w.sets:
            for m in muscles_for(s):
                counts[monday][m] += 1
    return [VolumeWeek(week_start=k, sets=dict(v)) for k, v in sorted(counts.items())]
