"""FastAPI application: every backend route lives under /api."""

import calendar
from contextlib import asynccontextmanager
from datetime import date

from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from .db import get_session, init_db
from .models import Exercise, Set, Workout
from .schemas import ExerciseIn, ExerciseOut, Health, WorkoutIn, WorkoutOut


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    yield


app = FastAPI(title="Lift Tracker API", version="0.1.0", lifespan=lifespan)

# Local dev only: the Vite dev server runs on :5173 and calls the API on :8000.
# In production the frontend and API share one domain, so CORS doesn't apply.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health", response_model=Health)
def health(session: Session = Depends(get_session)) -> Health:
    try:
        session.execute(text("SELECT 1"))
        db_status = "ok"
    except Exception:  # pragma: no cover - only hit when the DB is down
        db_status = "unreachable"
    return Health(status="ok", database=db_status)


# --- Exercises --------------------------------------------------------------


@app.get("/api/exercises", response_model=list[ExerciseOut])
def list_exercises(session: Session = Depends(get_session)) -> list[Exercise]:
    return list(
        session.scalars(
            select(Exercise).where(Exercise.active).order_by(Exercise.split_day, Exercise.name)
        )
    )


@app.post("/api/exercises", response_model=ExerciseOut, status_code=201)
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


@app.get("/api/workouts", response_model=list[WorkoutOut])
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


@app.post("/api/workouts", response_model=WorkoutOut, status_code=201)
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
