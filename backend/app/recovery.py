"""Per-muscle recovery: how "fresh" each muscle is, for the body heat map.

Model (v1, deliberately simple and explainable)
-----------------------------------------------
For every muscle m and every session s that trained it:

    load_s    = min(1, sets_s / FULL_LOAD_SETS)          # how hard it was hit
    decay_s   = max(0, 1 - days_since_s / RECOVERY_DAYS)  # linear fade over 3 days
    fatigue_m = max over sessions s of (load_s * decay_s)

so fatigue is 1.0 the day of a full session, ~0.67 the next day, ~0.33 the day
after, and 0 from day 3 on. Taking the max (not the sum) means two light
sessions in a row don't add up to more than one hard one; v2 will replace this
with exponentially decaying, summed load (the fitness-fatigue model), with the
decay rate fit from data. See docs/math/muscle-recovery.md.
"""

from collections import defaultdict
from dataclasses import dataclass
from datetime import date
from enum import StrEnum

from .models import SplitDay


class Muscle(StrEnum):
    chest = "chest"
    shoulders = "shoulders"
    biceps = "biceps"
    triceps = "triceps"
    forearms = "forearms"
    abs = "abs"
    obliques = "obliques"
    traps = "traps"
    lats = "lats"
    lower_back = "lower_back"
    glutes = "glutes"
    quads = "quads"
    hamstrings = "hamstrings"
    calves = "calves"


# Used when an exercise has no muscles tagged, or a session was logged without
# individual sets (e.g. imported history that only says "legs day").
DEFAULT_MUSCLES: dict[SplitDay, list[Muscle]] = {
    SplitDay.chest_bi: [Muscle.chest, Muscle.biceps],
    SplitDay.back_shoulder_tri: [Muscle.lats, Muscle.traps, Muscle.shoulders, Muscle.triceps],
    SplitDay.legs: [Muscle.quads, Muscle.hamstrings, Muscle.glutes, Muscle.calves],
}

RECOVERY_DAYS = 3
FULL_LOAD_SETS = 4  # 2 exercises x 2 sets on one muscle counts as a full hit


@dataclass(frozen=True)
class Hit:
    """One session's work on one muscle."""

    muscle: Muscle
    day: date
    sets: int | None  # None = unknown volume, treated as a full hit


@dataclass
class MuscleState:
    fatigue: float = 0.0  # 0 = fully recovered, 1 = just hammered
    last_trained: date | None = None
    days_since: int | None = None


def load(sets: int | None) -> float:
    if sets is None:
        return 1.0
    return min(1.0, sets / FULL_LOAD_SETS)


def decay(days_since: int) -> float:
    if days_since < 0:  # logged for a future date; ignore
        return 0.0
    return max(0.0, 1.0 - days_since / RECOVERY_DAYS)


def muscle_states(hits: list[Hit], today: date) -> dict[Muscle, MuscleState]:
    # Sum sets per (muscle, day) first: two chest exercises in one session are
    # one bigger hit, not two separate ones.
    per_day: dict[tuple[Muscle, date], int | None] = defaultdict(int)
    for h in hits:
        key = (h.muscle, h.day)
        if h.sets is None or per_day[key] is None:
            per_day[key] = None
        else:
            per_day[key] += h.sets

    states = {m: MuscleState() for m in Muscle}
    for (muscle, day), sets in per_day.items():
        days_since = (today - day).days
        if days_since < 0:
            continue
        s = states[muscle]
        s.fatigue = max(s.fatigue, round(load(sets) * decay(days_since), 3))
        if s.last_trained is None or day > s.last_trained:
            s.last_trained = day
            s.days_since = days_since
    return states
