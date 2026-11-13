"""Exercises, workouts, the calendar and the logging flow."""

import calendar
from collections import defaultdict
from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from .. import recovery
from ..db import get_session
from ..models import Exercise, Set, SplitDay, WhoopDaily, Workout
from ..queries import all_sets, workouts_between
from ..schemas import (
    CalendarDay,
    CalendarMonth,
    DayDetail,
    DayExercise,
    DaySet,
    DayWorkout,
    ExerciseIn,
    ExerciseOut,
    LastSet,
    LogTemplate,
    Summary,
    TemplateExercise,
    WhoopToday,
    WorkoutIn,
    WorkoutOut,
)
from ..strength import e1rm

router = APIRouter()


# --- Exercises --------------------------------------------------------------


@router.get("/exercises", response_model=list[ExerciseOut])
def list_exercises(session: Session = Depends(get_session)) -> list[Exercise]:
    return list(
        session.scalars(
            select(Exercise).where(Exercise.active).order_by(Exercise.split_day, Exercise.name)
        )
    )


@router.post("/exercises", response_model=ExerciseOut, status_code=201)
def create_exercise(body: ExerciseIn, session: Session = Depends(get_session)) -> Exercise:
    exercise = Exercise(**body.model_dump())
    session.add(exercise)
    try:
        session.commit()
    except IntegrityError as err:
        session.rollback()
        raise HTTPException(409, f"Exercise '{body.name}' already exists") from err
    return exercise


# --- Workouts ---------------------------------------------------------------


@router.get("/workouts", response_model=list[WorkoutOut])
def list_workouts(
    year: int = Query(ge=2000, le=2100),
    month: int = Query(ge=1, le=12),
    session: Session = Depends(get_session),
) -> list[Workout]:
    """All workouts in one calendar month (feeds the calendar view)."""
    first = date(year, month, 1)
    last = date(year, month, calendar.monthrange(year, month)[1])
    return list(
        session.scalars(
            select(Workout)
            .where(Workout.date.between(first, last))
            .options(selectinload(Workout.sets))
            .order_by(Workout.date)
        )
    )


@router.post("/workouts", response_model=WorkoutOut, status_code=201)
def create_workout(body: WorkoutIn, session: Session = Depends(get_session)) -> Workout:
    exercise_ids = {s.exercise_id for s in body.sets}
    if exercise_ids:
        found = set(session.scalars(select(Exercise.id).where(Exercise.id.in_(exercise_ids))))
        missing = exercise_ids - found
        if missing:
            raise HTTPException(422, f"Unknown exercise ids: {sorted(missing)}")

    workout = Workout(
        date=body.date,
        split_day=body.split_day,
        notes=body.notes,
        sets=[Set(**s.model_dump()) for s in body.sets],
    )
    session.add(workout)
    session.commit()
    session.refresh(workout)
    return workout


@router.delete("/workouts/{workout_id}", status_code=204)
def delete_workout(workout_id: int, session: Session = Depends(get_session)) -> None:
    workout = session.get(Workout, workout_id)
    if workout is None:
        raise HTTPException(404, "Workout not found")
    session.delete(workout)
    session.commit()


# --- Calendar ---------------------------------------------------------------


@router.get("/day/{day}", response_model=DayDetail)
def day_detail(day: date, session: Session = Depends(get_session)) -> DayDetail:
    """Everything for one calendar day: exercises, sets, PRs and WHOOP."""
    workouts = workouts_between(session, day, day)

    # Best e1RM per exercise from all earlier days, to flag PRs.
    ex_ids = {s.exercise_id for w in workouts for s in w.sets}
    prior_best: dict[int, float] = defaultdict(float)
    if ex_ids:
        earlier = session.scalars(
            select(Set).join(Workout).where(Set.exercise_id.in_(ex_ids), Workout.date < day)
        )
        for s in earlier:
            est = e1rm(s.weight, s.reps, s.rir)
            prior_best[s.exercise_id] = max(prior_best[s.exercise_id], est)

    out = []
    for w in workouts:
        by_ex: dict[int, DayExercise] = {}
        running_best = dict(prior_best)
        pr_count = 0
        for s in w.sets:
            est = e1rm(s.weight, s.reps, s.rir)
            # A PR beats every earlier day; the first time an exercise is ever
            # logged doesn't count.
            had_history = s.exercise_id in prior_best
            is_pr = had_history and est > running_best.get(s.exercise_id, 0.0)
            running_best[s.exercise_id] = max(running_best.get(s.exercise_id, 0.0), est)
            pr_count += is_pr
            entry = by_ex.setdefault(
                s.exercise_id, DayExercise(exercise_id=s.exercise_id, name=s.exercise.name, sets=[])
            )
            entry.sets.append(
                DaySet(
                    set_number=s.set_number,
                    weight=s.weight,
                    reps=s.reps,
                    rir=s.rir,
                    e1rm=round(est, 1),
                    is_pr=is_pr,
                )
            )
        out.append(
            DayWorkout(
                id=w.id,
                split_day=w.split_day,
                notes=w.notes,
                exercises=list(by_ex.values()),
                total_sets=len(w.sets),
                pr_count=pr_count,
            )
        )

    whoop = session.scalars(select(WhoopDaily).where(WhoopDaily.date == day)).first()
    return DayDetail(
        date=day, workouts=out, whoop=WhoopToday.model_validate(whoop) if whoop else None
    )


@router.get("/calendar", response_model=CalendarMonth)
def calendar_month(
    year: int = Query(ge=2000, le=2100),
    month: int = Query(ge=1, le=12),
    session: Session = Depends(get_session),
) -> CalendarMonth:
    """Per training day in a month: split, set count and PRs (for the grid)."""
    first = date(year, month, 1)
    last = date(year, month, calendar.monthrange(year, month)[1])

    # Same PR rule as the day panel: beats every earlier set of that exercise,
    # and the exercise was logged on some earlier day (a first session isn't a PR).
    best: dict[int, float] = {}
    first_day: dict[int, date] = {}
    days: dict[date, CalendarDay] = {}
    for s in all_sets(session):  # chronological
        d = s.workout.date
        if d > last:
            break
        ex = s.exercise_id
        first_day.setdefault(ex, d)
        est = e1rm(s.weight, s.reps, s.rir) if s.weight > 0 else 0.0
        is_pr = est > 0 and first_day[ex] < d and est > best.get(ex, 0.0)
        if est > 0:
            best[ex] = max(best.get(ex, 0.0), est)
        if d >= first:
            day = days.setdefault(
                d, CalendarDay(date=d, split_day=s.workout.split_day, sets=0, prs=0)
            )
            day.sets += 1
            day.prs += is_pr

    # Days logged without set detail still count as trained.
    for w in workouts_between(session, first, last):
        days.setdefault(w.date, CalendarDay(date=w.date, split_day=w.split_day, sets=0, prs=0))

    ordered = sorted(days.values(), key=lambda d: d.date)
    return CalendarMonth(
        days=ordered,
        max_sets=max((d.sets for d in ordered), default=0),
        prs=sum(d.prs for d in ordered),
    )


@router.get("/summary", response_model=Summary)
def summary(
    today: date | None = Query(default=None), session: Session = Depends(get_session)
) -> Summary:
    today = today or date.today()
    week_start = today - timedelta(days=today.weekday())  # Monday
    month_start = today.replace(day=1)

    def count_days(start: date | None) -> int:
        q = select(func.count(func.distinct(Workout.date))).where(Workout.date <= today)
        if start:
            q = q.where(Workout.date >= start)
        return session.scalar(q) or 0

    last = session.scalar(select(func.max(Workout.date)).where(Workout.date <= today))
    return Summary(
        this_week=count_days(week_start),
        this_month=count_days(month_start),
        total=count_days(None),
        last_workout=last,
    )


# --- Logging ----------------------------------------------------------------

SPLIT_ORDER = [SplitDay.chest_bi, SplitDay.back_shoulder_tri, SplitDay.legs]


def suggest_split(session: Session, today: date) -> SplitDay:
    """The split whose main muscles are most recovered; ties go to the one
    trained longest ago."""
    from .body import muscle_states_for  # local import avoids a cycle

    states = muscle_states_for(session, today)
    last_done = dict(
        session.execute(
            select(Workout.split_day, func.max(Workout.date))
            .where(Workout.date <= today)
            .group_by(Workout.split_day)
        ).all()
    )

    def score(split: SplitDay) -> tuple[float, date]:
        muscles = recovery.DEFAULT_MUSCLES[split]
        fatigue = sum(states[m].fatigue for m in muscles) / len(muscles)
        return (round(fatigue, 3), last_done.get(split, date.min))

    return min(SPLIT_ORDER, key=score)


@router.get("/log/template", response_model=LogTemplate)
def log_template(
    split_day: SplitDay | None = None,
    today: date | None = Query(default=None),
    session: Session = Depends(get_session),
) -> LogTemplate:
    """Exercises for a split, each with what you did last time."""
    today = today or date.today()
    suggested = suggest_split(session, today)
    split = split_day or suggested

    exercises = list(
        session.scalars(
            select(Exercise)
            .where(Exercise.active, Exercise.split_day == split)
            .order_by(Exercise.name)
        )
    )

    last_sets: dict[int, list[Set]] = {}
    last_date: dict[int, date] = {}
    order_hint: dict[int, int] = {}
    for s in all_sets(session):  # chronological
        if s.exercise.split_day != split:
            continue
        d = s.workout.date
        if last_date.get(s.exercise_id) != d:
            last_date[s.exercise_id] = d
            last_sets[s.exercise_id] = []
        last_sets[s.exercise_id].append(s)
        order_hint[s.exercise_id] = s.id

    # Keep the order you did them in last time; never-done exercises go last.
    exercises.sort(key=lambda e: (e.id not in order_hint, order_hint.get(e.id, 0), e.name))

    return LogTemplate(
        split_day=split,
        suggested_split=suggested,
        exercises=[
            TemplateExercise(
                id=e.id,
                name=e.name,
                muscles=[recovery.Muscle(m) for m in e.muscles or []],
                last_date=last_date.get(e.id),
                last_sets=[
                    LastSet(set_number=s.set_number, weight=s.weight, reps=s.reps, rir=s.rir)
                    for s in last_sets.get(e.id, [])
                ],
            )
            for e in exercises
        ],
    )
