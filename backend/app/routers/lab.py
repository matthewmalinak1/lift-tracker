"""The Lab tab: what each model knows so far, and what it still needs."""

from datetime import date
from statistics import median

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import backtest as bt
from .. import readiness as rd
from ..db import get_session
from ..models import Exercise, WhoopDaily, Workout
from ..queries import all_sets, session_bests
from ..schemas import (
    Backtest,
    BacktestLift,
    Lab,
    LabModel,
    PlateauRow,
    Readiness,
    ReadinessEffect,
    ReadinessToday,
)
from ..strength import MIN_OBS_TO_FIT, PLATEAU_MIN_SESSIONS, fit_trend_kalman, trend
from .body import muscle_states_for
from .progress import trend_out

router = APIRouter()

READINESS_SESSIONS_NEEDED = 40  # lifting days with same-day WHOOP data
FITNESS_FATIGUE_DAYS_NEEDED = 56  # 8 weeks of history


_WHOOP_COLS = [k for k, _, _ in rd.FACTORS]


def readiness_fit(session: Session) -> rd.Fit | None:
    """Fit the readiness model on every lifting day that has WHOOP data.

    Each day's outcome is the average % surprise across that day's lifts,
    against the trend filter's walk-forward (no look-ahead) forecasts.
    """
    bests = session_bests(all_sets(session))
    by_day: dict[date, list[float]] = {}
    for ex_id, obs in bests.items():
        for p in bt.walk_forward(ex_id, obs):
            if p.day is not None:
                by_day.setdefault(p.day, []).append(100 * (p.actual - p.predicted) / p.predicted)

    whoop = {
        w.date: {k: getattr(w, k) for k in _WHOOP_COLS}
        for w in session.scalars(select(WhoopDaily))
    }
    base = rd.baseline(list(whoop.values()))
    days = [
        rd.Day(d, sum(v) / len(v), len(v), whoop[d])
        for d, v in sorted(by_day.items())
        if d in whoop
    ]
    return rd.fit(days, base)


@router.get("/lab", response_model=Lab)
def lab(today: date | None = Query(default=None), session: Session = Depends(get_session)) -> Lab:
    today = today or date.today()
    bests = session_bests(all_sets(session))
    names = dict(session.execute(select(Exercise.id, Exercise.name)).all())

    # 1. Kalman filter
    fits = {ex: fit_trend_kalman(obs) for ex, obs in bests.items() if len(obs) >= 2}
    fitted = [f for f in fits.values() if f.fitted]
    max_sessions = max((len(o) for o in bests.values()), default=0)
    if fitted:
        kalman_head = (
            f"Tracking {len(fits)} lifts. Typical session-to-session noise: "
            f"{median(f.noise_pct for f in fitted):.1f}% of your max, which the filter "
            "separates from real strength change."
        )
    elif fits:
        kalman_head = (
            f"Tracking {len(fits)} lifts with default noise settings until a lift has "
            f"{MIN_OBS_TO_FIT} sessions to fit them from."
        )
    else:
        kalman_head = None

    # 2. Plateau detection
    plateaus = []
    for ex_id, obs in bests.items():
        t = trend(obs, today)
        if t.status != "not_enough_data":
            plateaus.append(PlateauRow(exercise_id=ex_id, name=names[ex_id], trend=trend_out(t)))
    order = {"plateau": 0, "declining": 1, "unclear": 2, "improving": 3}
    plateaus.sort(key=lambda p: (order[p.trend.status], p.name))
    n_flat = sum(p.trend.status == "plateau" for p in plateaus)
    n_up = sum(p.trend.status == "improving" for p in plateaus)
    n_down = sum(p.trend.status == "declining" for p in plateaus)
    n_unclear = sum(p.trend.status == "unclear" for p in plateaus)

    # 3. Recovery heat map
    recovering = sum(s.fatigue > 0 for s in muscle_states_for(session, today).values())

    # 4. Readiness model needs lifting days that also have WHOOP data.
    rfit = readiness_fit(session)
    if rfit:
        top = max(rfit.effects, key=lambda e: abs(e.p_positive - 0.5))
        direction = "helps" if top.mean > 0 else "hurts"
        readiness_head = (
            f"First estimates from {rfit.days} days: strongest signal is {top.label} "
            f"({top.mean:+.1f}% per SD, {max(top.p_positive, 1 - top.p_positive):.0%} chance it "
            f"{direction}). Ranges are wide until ~{READINESS_SESSIONS_NEEDED} days."
        )
    else:
        readiness_head = None
    paired = session.scalar(
        select(func.count(func.distinct(Workout.date)))
        .join(WhoopDaily, WhoopDaily.date == Workout.date)
        .where(Workout.date <= today)
    ) or 0

    # 5. Fitness-fatigue needs a long enough history.
    first = session.scalar(select(func.min(Workout.date)))
    history_days = (today - first).days if first else 0

    models = [
        LabModel(
            key="kalman",
            name="Strength filter",
            question="What is my true strength today, and how sure are we?",
            status="live" if fits else "collecting",
            progress=min(1.0, max_sessions / MIN_OBS_TO_FIT),
            progress_label=f"{max_sessions} / {MIN_OBS_TO_FIT} sessions on your most-logged lift",
            headline=kalman_head,
            doc="docs/math/kalman-e1rm.md",
        ),
        LabModel(
            key="plateau",
            name="Plateau detection",
            question="Is each lift still going up, or has it stalled?",
            status="live" if plateaus else "collecting",
            progress=None if plateaus else min(1.0, max_sessions / PLATEAU_MIN_SESSIONS),
            progress_label=None
            if plateaus
            else f"Needs {PLATEAU_MIN_SESSIONS} sessions of a lift in the last 6 weeks",
            headline=(
                f"Last 6 weeks: {n_up} improving, {n_flat} plateaued, {n_down} declining, "
                f"{n_unclear} still unclear (need more sessions)."
            )
            if plateaus
            else None,
            doc="docs/math/kalman-e1rm.md#plateau-detection",
        ),
        LabModel(
            key="recovery",
            name="Muscle recovery map",
            question="Which muscles are still recovering?",
            status="live",
            progress=None,
            progress_label=None,
            headline=f"{recovering} muscle groups recovering right now.",
            doc="docs/math/muscle-recovery.md",
        ),
        LabModel(
            key="readiness",
            name="Readiness model (Bayesian)",
            question="How much do recovery, HRV and sleep change how strong I am that day?",
            status="live" if rfit else "collecting",
            progress=min(1.0, paired / READINESS_SESSIONS_NEEDED),
            progress_label=f"{paired} / {READINESS_SESSIONS_NEEDED} lifting days with WHOOP data",
            headline=readiness_head,
            doc="docs/math/readiness.md",
        ),
        LabModel(
            key="fitness_fatigue",
            name="Fitness-fatigue model",
            question="How do training load, fitness and fatigue add up over time?",
            status="collecting" if history_days < FITNESS_FATIGUE_DAYS_NEEDED else "planned",
            progress=min(1.0, history_days / FITNESS_FATIGUE_DAYS_NEEDED),
            progress_label=f"{history_days} / {FITNESS_FATIGUE_DAYS_NEEDED} days of history",
            headline=f"Enough history ({history_days} days); this model is next on the roadmap."
            if history_days >= FITNESS_FATIGUE_DAYS_NEEDED
            else None,
            doc="docs/math/README.md#4-fitness-fatigue-model",
        ),
    ]
    return Lab(models=models, plateaus=plateaus)


@router.get("/lab/backtest", response_model=Backtest)
def backtest(session: Session = Depends(get_session)) -> Backtest:
    """Out-of-sample test of the strength filters on your own history."""
    bests = session_bests(all_sets(session))
    names = dict(session.execute(select(Exercise.id, Exercise.name)).all())

    all_preds: list[bt.Prediction] = []
    per_lift = []
    for ex_id, obs in bests.items():
        preds = bt.walk_forward(ex_id, obs)
        if not preds:
            continue
        all_preds.extend(preds)
        s = bt.summarize(preds)
        per_lift.append(
            BacktestLift(
                exercise_id=ex_id,
                name=names[ex_id],
                predictions=s.predictions,
                coverage_95=round(s.coverage_95, 3),
                mae_pct=round(s.mae_pct, 2),
                naive_mae_pct=round(s.naive_mae_pct, 2),
                level_only_mae_pct=round(s.level_only_mae_pct, 2),
            )
        )
    per_lift.sort(key=lambda r: -r.predictions)

    days = [o.day for obs in bests.values() for o in obs]
    s = bt.summarize(all_preds)

    def r(v: float | None, d: int = 3) -> float | None:
        return None if v is None else round(v, d)

    return Backtest(
        predictions=s.predictions,
        lifts=s.lifts,
        sessions=session.scalar(select(func.count(func.distinct(Workout.date)))) or 0,
        date_from=min(days) if days else None,
        date_to=max(days) if days else None,
        coverage_95=r(s.coverage_95),
        band_pct=r(s.band_pct, 2),
        mae_pct=r(s.mae_pct, 2),
        naive_mae_pct=r(s.naive_mae_pct, 2),
        level_only_mae_pct=r(s.level_only_mae_pct, 2),
        improvement_pct=r(s.improvement_pct, 1),
        per_lift=per_lift,
    )


@router.get("/lab/readiness", response_model=Readiness)
def readiness(
    today: date | None = Query(default=None), session: Session = Depends(get_session)
) -> Readiness:
    """Bayesian readiness model: effect of recovery, HRV and sleep on daily strength."""
    today = today or date.today()
    fit = readiness_fit(session)
    paired = session.scalar(
        select(func.count(func.distinct(Workout.date)))
        .join(WhoopDaily, WhoopDaily.date == Workout.date)
    ) or 0
    if fit is None:
        return Readiness(
            status="collecting", days=paired, days_min=rd.MIN_DAYS,
            days_target=READINESS_SESSIONS_NEEDED, sessions=0, effects=[],
            intercept=None, intercept_lo90=None, intercept_hi90=None, noise_sd=None, today=None,
        )

    today_out = None
    row = session.scalar(select(WhoopDaily).where(WhoopDaily.date == today))
    if row is not None:
        exp = fit.expected_today({k: getattr(row, k) for k in _WHOOP_COLS})
        if exp:
            today_out = ReadinessToday(
                date=today, expected=round(exp[0], 2), lo90=round(exp[1], 2), hi90=round(exp[2], 2)
            )

    def r(v: float) -> float:
        return round(v, 3)

    return Readiness(
        status="live",
        days=fit.days,
        days_min=rd.MIN_DAYS,
        days_target=READINESS_SESSIONS_NEEDED,
        sessions=fit.sessions,
        effects=[
            ReadinessEffect(
                key=e.key, label=e.label, unit=e.unit, sd_raw=r(e.sd_raw), mean=r(e.mean),
                lo90=r(e.lo90), hi90=r(e.hi90), p_positive=r(e.p_positive), prior_sd=r(e.prior_sd),
            )
            for e in fit.effects
        ],
        intercept=r(fit.intercept),
        intercept_lo90=r(fit.intercept_lo90),
        intercept_hi90=r(fit.intercept_hi90),
        noise_sd=r(fit.noise_sd),
        today=today_out,
    )
