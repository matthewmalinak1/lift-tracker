"""The Lab tab: what each model knows so far, and what it still needs."""

from datetime import date
from statistics import median

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..db import get_session
from ..models import Exercise, WhoopDaily, Workout
from ..queries import all_sets, session_bests
from ..schemas import Lab, LabModel, PlateauRow
from ..strength import MIN_OBS_TO_FIT, PLATEAU_MIN_SESSIONS, fit_kalman, trend
from .body import muscle_states_for
from .progress import trend_out

router = APIRouter()

READINESS_SESSIONS_NEEDED = 40  # lifting days with same-day WHOOP data
FITNESS_FATIGUE_DAYS_NEEDED = 56  # 8 weeks of history


@router.get("/lab", response_model=Lab)
def lab(today: date | None = Query(default=None), session: Session = Depends(get_session)) -> Lab:
    today = today or date.today()
    bests = session_bests(all_sets(session))
    names = dict(session.execute(select(Exercise.id, Exercise.name)).all())

    # 1. Kalman filter
    fits = {ex: fit_kalman(obs) for ex, obs in bests.items() if len(obs) >= 2}
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
            status="collecting" if paired < READINESS_SESSIONS_NEEDED else "live",
            progress=min(1.0, paired / READINESS_SESSIONS_NEEDED),
            progress_label=f"{paired} / {READINESS_SESSIONS_NEEDED} lifting days with WHOOP data",
            headline=None,
            doc="docs/math/README.md#3-bayesian-readiness-model",
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
