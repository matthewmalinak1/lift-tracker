"""Bodyweight log and WHOOP trend charts (Progress tab: Weight and Health)."""

from datetime import date, timedelta
from statistics import mean

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import settings
from ..db import get_session
from ..models import BodyWeight, WhoopDaily, Workout
from ..schemas import HealthTrends, TrendDay, WeightIn, WeightPoint, WeightSummary
from ..strength import Obs, fit_kalman

router = APIRouter()


# --- Bodyweight -------------------------------------------------------------


@router.put("/weight", status_code=204)
def log_weight(body: WeightIn, session: Session = Depends(get_session)) -> None:
    """One weigh-in per day; logging again the same day replaces it."""
    row = session.scalars(select(BodyWeight).where(BodyWeight.date == body.date)).first()
    if row is None:
        row = BodyWeight(date=body.date, weight=body.weight)
        session.add(row)
    else:
        row.weight = body.weight
    session.commit()


@router.delete("/weight/{day}", status_code=204)
def delete_weight(day: date, session: Session = Depends(get_session)) -> None:
    row = session.scalars(select(BodyWeight).where(BodyWeight.date == day)).first()
    if row is None:
        raise HTTPException(404, "No weigh-in that day")
    session.delete(row)
    session.commit()


def _slope_per_week(points: list[WeightPoint]) -> float | None:
    if len(points) < 3:
        return None
    x0 = points[0].date
    xs = [(p.date - x0).days for p in points]
    ys = [p.trend for p in points]
    mx, my = mean(xs), mean(ys)
    sxx = sum((x - mx) ** 2 for x in xs)
    if sxx == 0:
        return None
    return 7 * sum((x - mx) * (y - my) for x, y in zip(xs, ys, strict=True)) / sxx


@router.get("/weight", response_model=WeightSummary)
def weight_summary(
    days: int = Query(default=90, ge=7, le=730),
    today: date | None = Query(default=None),
    session: Session = Depends(get_session),
) -> WeightSummary:
    """Weigh-ins with a Kalman-filtered trend: the same filter as the lifts,
    which separates real weight change from daily water and food swings."""
    today = today or date.today()
    rows = list(session.scalars(select(BodyWeight).order_by(BodyWeight.date)))
    empty = WeightSummary(
        unit=settings.weight_unit,
        points=[],
        today_logged=False,
        latest=None,
        trend_now=None,
        change_7d=None,
        rate_per_week=None,
        noise_lb=None,
    )
    if not rows:
        return empty

    fit = fit_kalman([Obs(r.date, r.weight) for r in rows])
    points = [
        WeightPoint(
            date=p.day,
            weight=round(p.observed, 1),
            trend=round(p.mean, 2),
            lower=round(p.lower, 2),
            upper=round(p.upper, 2),
        )
        for p in fit.points
    ]
    shown = [p for p in points if (today - p.date).days < days]
    last = points[-1]
    week_ago = [p for p in points if p.date <= last.date - timedelta(days=7)]
    recent = [p for p in points if (last.date - p.date).days <= 21]
    rate = _slope_per_week(recent)
    return WeightSummary(
        unit=settings.weight_unit,
        points=shown,
        today_logged=last.date == today,
        latest=last.weight,
        trend_now=round(last.trend, 1),
        change_7d=round(last.trend - week_ago[-1].trend, 1) if week_ago else None,
        rate_per_week=None if rate is None else round(rate, 2),
        noise_lb=round(fit.r**0.5, 1) if fit.fitted else None,
    )


# --- WHOOP trends -------------------------------------------------------------

TREND_FIELDS = (
    "recovery_score",
    "strain",
    "sleep_hours",
    "sleep_performance",
    "steps",
    "hrv_rmssd_ms",
    "resting_hr",
)


@router.get("/health/trends", response_model=HealthTrends)
def health_trends(
    days: int = Query(default=30, ge=7, le=365),
    today: date | None = Query(default=None),
    session: Session = Depends(get_session),
) -> HealthTrends:
    today = today or date.today()
    start = today - timedelta(days=days - 1)
    whoop = {
        w.date: w
        for w in session.scalars(select(WhoopDaily).where(WhoopDaily.date.between(start, today)))
    }
    trained = set(session.scalars(select(Workout.date).where(Workout.date.between(start, today))))
    out = []
    for i in range(days):
        d = start + timedelta(days=i)
        w = whoop.get(d)
        out.append(
            TrendDay(
                date=d,
                workout=d in trained,
                **{f: (getattr(w, f) if w else None) for f in TREND_FIELDS},
            )
        )

    def avg(field: str) -> float | None:
        vals = [getattr(x, field) for x in out if getattr(x, field) is not None]
        return round(mean(vals), 1) if vals else None

    return HealthTrends(days=out, averages={f: avg(f) for f in TREND_FIELDS})
