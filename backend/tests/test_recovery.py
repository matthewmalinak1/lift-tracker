from datetime import date, timedelta

import pytest

from app.recovery import FULL_LOAD_SETS, Hit, Muscle, decay, load, muscle_states

TODAY = date(2026, 11, 12)


def days_ago(n: int) -> date:
    return TODAY - timedelta(days=n)


@pytest.mark.parametrize(
    ("days", "expected"), [(0, 1.0), (1, 2 / 3), (2, 1 / 3), (3, 0.0), (10, 0.0)]
)
def test_linear_decay_over_three_days(days, expected):
    assert decay(days) == pytest.approx(expected)


def test_load_scales_with_sets_and_caps_at_one():
    assert load(2) == pytest.approx(2 / FULL_LOAD_SETS)
    assert load(FULL_LOAD_SETS) == 1.0
    assert load(20) == 1.0
    assert load(None) == 1.0  # unknown volume = full hit


def test_sets_from_one_session_add_up():
    # Bench (2 sets) + incline (2 sets) + flyes (2 sets) = one full chest hit.
    hits = [Hit(Muscle.chest, TODAY, 2)] * 3
    assert muscle_states(hits, TODAY)[Muscle.chest].fatigue == 1.0


def test_untouched_muscles_are_fresh():
    states = muscle_states([Hit(Muscle.quads, days_ago(1), 6)], TODAY)
    assert states[Muscle.chest].fatigue == 0.0
    assert states[Muscle.chest].last_trained is None
    assert states[Muscle.quads].fatigue == pytest.approx(0.667, abs=1e-3)
    assert states[Muscle.quads].days_since == 1


def test_takes_the_worst_recent_session_not_the_sum():
    hits = [Hit(Muscle.lats, days_ago(2), 6), Hit(Muscle.lats, days_ago(1), 1)]
    s = muscle_states(hits, TODAY)[Muscle.lats]
    # 2 days ago full hit -> 1 * 1/3 = 0.333; yesterday 1 set -> (1/4) * (2/3) = 0.167
    assert s.fatigue == pytest.approx(0.333, abs=1e-3)
    assert s.last_trained == days_ago(1)


def test_future_dated_sessions_are_ignored():
    assert muscle_states([Hit(Muscle.abs, TODAY + timedelta(days=1), 6)], TODAY)[
        Muscle.abs
    ].fatigue == 0.0
