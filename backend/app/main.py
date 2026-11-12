"""FastAPI application: every backend route lives under /api."""

import asyncio
import calendar
from datetime import date

from fastapi import APIRouter, Cookie, Depends, FastAPI, HTTPException, Query, Response
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from . import auth
from .db import engine, get_session
from .models import Exercise, Set, Workout
from .schemas import (
    ExerciseIn,
    ExerciseOut,
    Health,
    LoginIn,
    Me,
    WorkoutIn,
    WorkoutOut,
)

app = FastAPI(title="Lift Tracker API", version="0.2.0")

# Local dev only: the Vite dev server runs on :5173 and calls the API on :8000.
# In production the frontend and API share one domain, so CORS doesn't apply.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
    allow_credentials=True,
)

# Every route on this router requires a valid session cookie.
private = APIRouter(prefix="/api", dependencies=[Depends(auth.require_auth)])


@app.get("/api/health", response_model=Health)
def health() -> Health:
    """Public status check. Reports the database without exposing any data."""
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        db_status = "ok"
    except Exception:  # noqa: BLE001 - any failure means "unreachable"
        db_status = "unreachable"
    return Health(status="ok", database=db_status)


# --- Auth (public) ----------------------------------------------------------


@app.post("/api/auth/login", response_model=Me)
async def login(body: LoginIn, response: Response) -> Me:
    if not auth.check_password(body.password):
        # Slow down repeated guessing.
        await asyncio.sleep(1)
        raise HTTPException(401, "Wrong password")
    auth.set_session_cookie(response, auth.make_token())
    return Me(logged_in=True)


@app.post("/api/auth/logout", response_model=Me)
def logout(response: Response) -> Me:
    auth.clear_session_cookie(response)
    return Me(logged_in=False)


@app.get("/api/auth/me", response_model=Me)
def me(session: str | None = Cookie(default=None)) -> Me:
    return Me(logged_in=auth.token_is_valid(session))


# --- Exercises --------------------------------------------------------------


@private.get("/exercises", response_model=list[ExerciseOut])
def list_exercises(session: Session = Depends(get_session)) -> list[Exercise]:
    return list(
        session.scalars(
            select(Exercise).where(Exercise.active).order_by(Exercise.split_day, Exercise.name)
        )
    )


@private.post("/exercises", response_model=ExerciseOut, status_code=201)
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


@private.get("/workouts", response_model=list[WorkoutOut])
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


@private.post("/workouts", response_model=WorkoutOut, status_code=201)
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


app.include_router(private)
