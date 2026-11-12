import math
import random
from datetime import date, timedelta

import pytest

from app.strength import Obs, e1rm, fit_kalman, trend

START = date(2026, 1, 1)


def test_e1rm_epley_with_rir():
    assert e1rm(225, 5) == pytest.approx(225 * (1 + 5 / 30))
    # 5 reps with 2 in reserve = as if 7 to failure
    assert e1rm(225, 5, rir=2) == pytest.approx(225 * (1 + 7 / 30))
    assert e1rm(315, 1) == 315  # a true single is its own 1RM


def simulate(n, true_noise_pct, drift_pct_week, seed, gap=3, level=300.0):
    """Random-walk strength plus noisy session readings."""
    rng = random.Random(seed)
    x, obs, truth = level, [], []
    for i in range(n):
        if i:
            x += rng.gauss(0, drift_pct_week / 100 * level * math.sqrt(gap / 7))
        truth.append(x)
        reading = x + rng.gauss(0, true_noise_pct / 100 * level)
        obs.append(Obs(START + timedelta(days=i * gap), reading))
    return obs, truth


def test_few_sessions_use_defaults():
    fit = fit_kalman([Obs(START, 300), Obs(START + timedelta(days=3), 305)])
    assert not fit.fitted
    assert len(fit.points) == 2
    # Estimate lands between the two readings
    assert 300 < fit.points[-1].mean < 305


def test_mle_recovers_measurement_noise_roughly():
    estimates = []
    for seed in range(8):
        obs, _ = simulate(80, true_noise_pct=3.0, drift_pct_week=0.8, seed=seed)
        estimates.append(fit_kalman(obs).noise_pct)
    avg = sum(estimates) / len(estimates)
    assert 2.0 < avg < 4.0  # true value 3%


def test_filter_beats_raw_readings_and_band_is_calibrated():
    raw_err = filt_err = 0.0
    inside = total = 0
    for seed in range(10):
        obs, truth = simulate(60, true_noise_pct=4.0, drift_pct_week=0.5, seed=100 + seed)
        fit = fit_kalman(obs)
        for p, o, t in zip(fit.points[5:], obs[5:], truth[5:], strict=True):
            raw_err += (o.value - t) ** 2
            filt_err += (p.mean - t) ** 2
            inside += p.lower <= t <= p.upper
            total += 1
    assert filt_err < 0.6 * raw_err  # smoothing removes most session noise
    assert 0.85 < inside / total < 0.99  # ~95% band covers the truth ~95% of the time


def test_band_widens_after_a_break():
    obs, _ = simulate(20, 3.0, 0.8, seed=7)
    fit = fit_kalman(obs)
    _, sd_now = fit.predict(obs[-1].day)
    _, sd_later = fit.predict(obs[-1].day + timedelta(days=30))
    assert sd_later > sd_now


def test_trend_statuses():
    today = START + timedelta(days=42)
    rising = [Obs(START + timedelta(days=d), 300 + d * 0.5) for d in range(0, 43, 3)]
    assert trend(rising, today).status == "improving"

    rng = random.Random(1)
    flat = [Obs(START + timedelta(days=d), 300 + rng.gauss(0, 1.5)) for d in range(0, 43, 3)]
    assert trend(flat, today).status == "plateau"  # tight data, clearly flat

    noisy = [Obs(START + timedelta(days=d), 300 + rng.gauss(0, 15)) for d in range(0, 43, 7)]
    assert trend(noisy, today).status == "unclear"  # can't tell flat from moving

    falling = [Obs(START + timedelta(days=d), 300 - d * 0.5) for d in range(0, 43, 3)]
    assert trend(falling, today).status == "declining"

    assert trend(rising[:2], today).status == "not_enough_data"
