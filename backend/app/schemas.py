"""Request/response shapes for the API (Pydantic v2)."""

from datetime import date

from pydantic import BaseModel, ConfigDict, Field

from .models import SplitDay
from .recovery import Muscle


class ExerciseIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    split_day: SplitDay
    equipment: str | None = None
    muscles: list[Muscle] = []


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


class LoginIn(BaseModel):
    password: str = Field(min_length=1, max_length=200)


class Me(BaseModel):
    logged_in: bool


class MuscleStatus(BaseModel):
    fatigue: float
    last_trained: date | None
    days_since: int | None


class WhoopToday(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    date: date
    recovery_score: float | None
    hrv_rmssd_ms: float | None
    resting_hr: float | None
    sleep_hours: float | None
    sleep_performance: float | None
    strain: float | None
    steps: int | None


class BodyStatus(BaseModel):
    today: date
    recovery_days: int
    muscles: dict[Muscle, MuscleStatus]
    whoop: WhoopToday | None


# --- Calendar day detail ----------------------------------------------------


class DaySet(BaseModel):
    set_number: int
    weight: float
    reps: int
    rir: int | None
    e1rm: float
    is_pr: bool  # best e1RM ever for this exercise, as of this day


class DayExercise(BaseModel):
    exercise_id: int
    name: str
    sets: list[DaySet]


class DayWorkout(BaseModel):
    id: int
    split_day: SplitDay
    notes: str | None
    exercises: list[DayExercise]
    total_sets: int
    pr_count: int


class DayDetail(BaseModel):
    date: date
    workouts: list[DayWorkout]
    whoop: WhoopToday | None


class Summary(BaseModel):
    this_week: int
    this_month: int
    total: int
    last_workout: date | None


# --- Logging ----------------------------------------------------------------


class LastSet(BaseModel):
    set_number: int
    weight: float
    reps: int
    rir: int | None


class TemplateExercise(BaseModel):
    id: int
    name: str
    muscles: list[Muscle]
    last_date: date | None
    last_sets: list[LastSet]


class LogTemplate(BaseModel):
    split_day: SplitDay
    suggested_split: SplitDay
    exercises: list[TemplateExercise]


# --- Progress ---------------------------------------------------------------


class LiftSummary(BaseModel):
    exercise_id: int
    name: str
    split_day: SplitDay
    muscles: list[Muscle]  # tagged muscles, primary first
    primary_muscle: Muscle  # used to group lifts on the Progress tab
    sessions: int
    best_e1rm: float | None
    current_estimate: float | None
    trend: str  # improving | plateau | declining | unclear | not_enough_data


class SeriesPoint(BaseModel):
    date: date
    observed: float
    estimate: float
    lower: float
    upper: float


class TrendOut(BaseModel):
    status: str
    pct_per_week: float | None
    ci_low: float | None
    ci_high: float | None
    sessions: int
    window_days: int


class LiftProgress(BaseModel):
    exercise_id: int
    name: str
    unit: str
    series: list[SeriesPoint]
    today_estimate: float | None
    today_lower: float | None
    today_upper: float | None
    fitted: bool
    noise_pct: float | None
    drift_pct_per_week: float | None
    best_e1rm: float | None
    best_e1rm_date: date | None
    heaviest_weight: float | None
    heaviest_weight_date: date | None
    trend: TrendOut


class VolumeWeek(BaseModel):
    week_start: date
    sets: dict[Muscle, int]


# --- Lab --------------------------------------------------------------------


class LabModel(BaseModel):
    key: str
    name: str
    question: str
    status: str  # "live" | "collecting" | "planned"
    progress: float | None  # 0-1 toward having enough data
    progress_label: str | None
    headline: str | None
    doc: str  # path in the repo


class PlateauRow(BaseModel):
    exercise_id: int
    name: str
    trend: TrendOut


class Lab(BaseModel):
    models: list[LabModel]
    plateaus: list[PlateauRow]


# --- Import -----------------------------------------------------------------


class ImportProblem(BaseModel):
    sheet: str
    row: int
    message: str


class ImportReport(BaseModel):
    committed: bool
    workouts: int  # workouts in the file
    sets: int
    new_exercises: list[str]
    date_from: date | None
    date_to: date | None
    already_in_app: int  # workouts skipped because that date + split exists
    errors: list[ImportProblem]
    warnings: list[ImportProblem]


# --- Backtest -----------------------------------------------------------------


class BacktestLift(BaseModel):
    exercise_id: int
    name: str
    predictions: int
    coverage_95: float
    mae_pct: float
    naive_mae_pct: float


class Backtest(BaseModel):
    predictions: int
    lifts: int
    sessions: int
    date_from: date | None
    date_to: date | None
    coverage_95: float | None
    band_pct: float | None
    mae_pct: float | None
    naive_mae_pct: float | None
    improvement_pct: float | None
    per_lift: list[BacktestLift]


# --- Calendar month view -----------------------------------------------------


class CalendarDay(BaseModel):
    date: date
    split_day: SplitDay
    sets: int
    prs: int


class CalendarMonth(BaseModel):
    days: list[CalendarDay]
    max_sets: int
    prs: int
