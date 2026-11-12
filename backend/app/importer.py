"""Import past workouts from the Excel template (frontend/public/lift-history-template.xlsx).

Two passes: `parse_workbook` turns the file into clean exercises and workouts
plus a list of problems, without touching the database; `apply` writes them.
The import endpoint runs the parse first as a preview and only applies it
once the user confirms and there are no errors.
"""

import io
import re
from collections import OrderedDict
from dataclasses import dataclass, field
from datetime import date, datetime

from openpyxl import load_workbook
from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import Exercise, Set, SplitDay, Workout
from .recovery import Muscle

SPLIT_ALIASES = {
    "chest/bi": SplitDay.chest_bi,
    "chest bi": SplitDay.chest_bi,
    "chest & bi": SplitDay.chest_bi,
    "chest_bi": SplitDay.chest_bi,
    "chest": SplitDay.chest_bi,
    "back/shoulder/tri": SplitDay.back_shoulder_tri,
    "back shoulder tri": SplitDay.back_shoulder_tri,
    "back_shoulder_tri": SplitDay.back_shoulder_tri,
    "back": SplitDay.back_shoulder_tri,
    "legs": SplitDay.legs,
    "leg": SplitDay.legs,
}

MUSCLE_ALIASES = {
    "lower back": "lower_back",
    "lowerback": "lower_back",
    "delts": "shoulders",
    "shoulder": "shoulders",
    "bicep": "biceps",
    "tricep": "triceps",
    "quad": "quads",
    "hamstring": "hamstrings",
    "glute": "glutes",
    "calf": "calves",
    "lat": "lats",
    "trap": "traps",
    "ab": "abs",
    "core": "abs",
    "forearm": "forearms",
    "oblique": "obliques",
    "pecs": "chest",
}


@dataclass
class Problem:
    sheet: str
    row: int
    message: str


@dataclass
class ParsedSet:
    exercise: str  # normalized key (lowercase name)
    set_number: int
    weight: float
    reps: int
    rir: int | None


@dataclass
class ParsedWorkout:
    day: date
    split: SplitDay
    sets: list[ParsedSet] = field(default_factory=list)


@dataclass
class ParsedExercise:
    name: str
    split: SplitDay
    muscles: list[str]


@dataclass
class ParseResult:
    exercises: dict[str, ParsedExercise]  # key: lowercase name
    workouts: list[ParsedWorkout]
    errors: list[Problem]
    warnings: list[Problem]


def _key(name: str) -> str:
    return re.sub(r"\s+", " ", name.strip()).lower()


def _split(value: object) -> SplitDay | None:
    if value is None:
        return None
    text = re.sub(r"\s*/\s*", "/", str(value).strip().lower())
    return SPLIT_ALIASES.get(text) or SPLIT_ALIASES.get(text.replace("/", " "))


def _muscles(value: object) -> tuple[list[str], list[str]]:
    """Returns (valid muscle names, unrecognised words)."""
    if value is None or str(value).strip() == "":
        return [], []
    good, bad = [], []
    for part in re.split(r"[,;/]", str(value)):
        word = part.strip().lower()
        if not word:
            continue
        word = MUSCLE_ALIASES.get(word, word).replace(" ", "_")
        if word in Muscle.__members__:
            if word not in good:
                good.append(word)
        else:
            bad.append(part.strip())
    return good, bad


def _date(value: object) -> date | None:
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    if value is None:
        return None
    text = str(value).strip()
    for fmt in ("%m/%d/%Y", "%m/%d/%y", "%Y-%m-%d", "%m-%d-%Y", "%b %d %Y", "%B %d %Y"):
        try:
            return datetime.strptime(text, fmt).date()
        except ValueError:
            continue
    return None


def _num(value: object) -> float | None:
    if value is None or str(value).strip() == "":
        return None
    try:
        return float(str(value).replace("lb", "").replace("lbs", "").strip())
    except ValueError:
        return None


def _is_example(*cells: object) -> bool:
    return any(isinstance(c, str) and c.strip().upper().startswith("EXAMPLE") for c in cells)


def _blank(cells: tuple) -> bool:
    return all(c is None or (isinstance(c, str) and not c.strip()) for c in cells)


def parse_workbook(data: bytes, existing: dict[str, Exercise], today: date) -> ParseResult:
    errors: list[Problem] = []
    warnings: list[Problem] = []
    try:
        wb = load_workbook(io.BytesIO(data), read_only=True, data_only=True)
    except Exception:  # noqa: BLE001 - any failure means "not a readable .xlsx"
        return ParseResult({}, [], [Problem("file", 0, "This isn't a readable .xlsx file.")], [])

    if "Lifts" not in wb.sheetnames:
        missing = Problem("file", 0, "No 'Lifts' tab found. Use the template.")
        return ParseResult({}, [], [missing], [])

    # --- Exercises tab (optional) --------------------------------------------
    exercises: dict[str, ParsedExercise] = {}
    if "Exercises" in wb.sheetnames:
        rows = wb["Exercises"].iter_rows(min_row=2, max_col=3, values_only=True)
        for r, row in enumerate(rows, 2):
            if _blank(row) or _is_example(row[0]):
                continue
            name, split_raw, muscles_raw = row
            if not name or not str(name).strip():
                errors.append(Problem("Exercises", r, "Exercise name is missing."))
                continue
            split = _split(split_raw)
            if split is None:
                errors.append(Problem("Exercises", r, f"Unknown split '{split_raw}'."))
                continue
            muscles, bad = _muscles(muscles_raw)
            if bad:
                errors.append(
                    Problem("Exercises", r, f"Unknown muscle name(s): {', '.join(bad)}.")
                )
            exercises[_key(str(name))] = ParsedExercise(str(name).strip(), split, muscles)

    # --- Lifts tab -------------------------------------------------------------
    workouts: OrderedDict[tuple[date, SplitDay], ParsedWorkout] = OrderedDict()
    lift_rows = wb["Lifts"].iter_rows(min_row=2, max_col=10, values_only=True)
    for r, row in enumerate(lift_rows, 2):
        row = tuple(row) + (None,) * (10 - len(row))
        if _blank(row[:9]) or _is_example(row[0], row[2]):
            continue
        day_raw, split_raw, name, w1, r1, i1, w2, r2, i2, _notes = row

        day = _date(day_raw)
        if day is None:
            errors.append(Problem("Lifts", r, f"Can't read the date '{day_raw}'."))
            continue
        if day > today:
            errors.append(Problem("Lifts", r, f"Date {day:%m/%d/%Y} is in the future."))
            continue
        if not name or not str(name).strip():
            errors.append(Problem("Lifts", r, "Exercise is missing."))
            continue
        key = _key(str(name))

        known = exercises.get(key)
        split = _split(split_raw) or (known.split if known else None)
        if split is None and key in existing:
            split = existing[key].split_day
        if split is None:
            errors.append(Problem("Lifts", r, f"Split is missing or unknown ('{split_raw}')."))
            continue

        if known is None and key not in existing:
            exercises[key] = ParsedExercise(str(name).strip(), split, [])
            warnings.append(
                Problem("Lifts", r, f"'{name}' isn't on the Exercises tab; adding it with no "
                        "muscle tags (the split's main muscles will be used).")
            )

        sets, bad_set = [], False
        for n, (w, reps, rir) in enumerate(((w1, r1, i1), (w2, r2, i2)), start=1):
            wv, rv, iv = _num(w), _num(reps), _num(rir)
            if wv is None and rv is None:
                continue
            if wv is None or rv is None or rv < 1:
                errors.append(Problem("Lifts", r, f"Set {n} needs both a weight and reps."))
                bad_set = True
                continue
            sets.append(ParsedSet(key, n, wv, int(rv), None if iv is None else int(iv)))
        if not sets:
            if not bad_set:
                errors.append(Problem("Lifts", r, "No sets on this row."))
            continue

        wo = workouts.setdefault((day, split), ParsedWorkout(day, split))
        wo.sets.extend(sets)

    return ParseResult(exercises, list(workouts.values()), errors, warnings)


@dataclass
class ApplyResult:
    workouts_added: int
    sets_added: int
    exercises_added: int
    skipped_existing: int  # workouts already in the app (same date + split)


def plan_skips(session: Session, parsed: ParseResult) -> set[tuple[date, SplitDay]]:
    """Workouts that already exist (same date and split), so re-importing the
    same file never creates duplicates."""
    days = {w.day for w in parsed.workouts}
    if not days:
        return set()
    rows = session.execute(
        select(Workout.date, Workout.split_day).where(Workout.date.in_(days))
    ).all()
    return {(d, s) for d, s in rows}


def apply(session: Session, parsed: ParseResult) -> ApplyResult:
    existing = {_key(e.name): e for e in session.scalars(select(Exercise))}
    added_ex = 0
    for key, pe in parsed.exercises.items():
        if key in existing:
            ex = existing[key]
            if pe.muscles and not ex.muscles:
                ex.muscles = pe.muscles  # fill in tags the app didn't have yet
            continue
        ex = Exercise(name=pe.name, split_day=pe.split, muscles=pe.muscles)
        session.add(ex)
        existing[key] = ex
        added_ex += 1
    session.flush()  # assign ids

    skip = plan_skips(session, parsed)
    added_w = added_s = 0
    for w in parsed.workouts:
        if (w.day, w.split) in skip:
            continue
        session.add(
            Workout(
                date=w.day,
                split_day=w.split,
                notes="Imported",
                sets=[
                    Set(
                        exercise_id=existing[s.exercise].id,
                        set_number=s.set_number,
                        weight=s.weight,
                        reps=s.reps,
                        rir=s.rir,
                    )
                    for s in w.sets
                ],
            )
        )
        added_w += 1
        added_s += len(w.sets)
    session.commit()
    return ApplyResult(added_w, added_s, added_ex, len(skip))
