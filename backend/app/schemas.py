"""Request/response shapes for the API (Pydantic v2)."""

from datetime import date

from pydantic import BaseModel, ConfigDict, Field

from .models import SplitDay


class ExerciseIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    split_day: SplitDay
    equipment: str | None = None


class ExerciseOut(ExerciseIn):
    model_config = ConfigDict(from_attributes=True)

    id: int
    active: bool


class SetIn(BaseModel):
    exercise_id: int
    set_number: int = Field(ge=1, le=10)
    weight: float = Field(ge=0)
    reps: int = Field(ge=1, le=100)
    rir: int | None = Field(default=None, ge=0, le=10)


class SetOut(SetIn):
    model_config = ConfigDict(from_attributes=True)

    id: int


class WorkoutIn(BaseModel):
    date: date
    split_day: SplitDay
    notes: str | None = None
    sets: list[SetIn] = []


class WorkoutOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    date: date
    split_day: SplitDay
    notes: str | None
    sets: list[SetOut]


class Health(BaseModel):
    status: str
    database: str
