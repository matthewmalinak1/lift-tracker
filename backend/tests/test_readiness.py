"""Bayesian readiness model: unit tests on simulated data, then the endpoint."""

import random
from datetime import date, timedelta

from app import readiness as rd
from app.db import SessionLocal
from app.models import WhoopDaily

KEYS = [k for k, _, _ in rd.FACTORS]


def simulate(n, effects, seed, noise=3.0):
    """n lifting days; `effects` = true % per SD for (recovery, HRV, sleep)."""
    rng = random.Random(seed)
    inputs = [
        {"recovery_score": rng.gauss(60, 15), "hrv_rmssd_ms": rng.gauss(70, 12),
         "sleep_hours": rng.gauss(7, 0.8)}
        for _ in range(n)
    ]
    base = rd.baseline(inputs)
    days = []
    for i, inp in enumerate(inputs):
        lifts = rng.randint(4, 8)
        z = [(inp[k] - base[k][0]) / base[k][1] for k in KEYS]
        y = sum(b * x for b, x in zip(effects, z, strict=True)) + rng.gauss(0, noise / lifts**0.5)
        days.append(rd.Day(date(2026, 1, 1) + timedelta(days=i), y, lifts, inp))
    return days, base


def test_needs_a_minimum_number_of_days():
    days, base = simulate(rd.MIN_DAYS - 1, [0, 0, 2], seed=1)
    assert rd.fit(days, base) is None


def test_recovers_a_real_effect():
    days, base = simulate(60, [0, 0, 1.5], seed=2)
    f = rd.fit(days, base)
    sleep = f.effects[2]
    assert sleep.lo90 < 1.5 < sleep.hi90
    assert sleep.p_positive > 0.99
    assert 2.0 < f.noise_sd < 4.0  # true per-lift noise is 3%


def test_skeptical_prior_shrinks_small_samples():
    # With few days, estimates are pulled toward zero relative to the data's own slope.
    days, base = simulate(rd.MIN_DAYS, [0, 0, 3.0], seed=3)
    small = rd.fit(days, base).effects[2]
    days, base = simulate(80, [0, 0, 3.0], seed=3)
    large = rd.fit(days, base).effects[2]
    assert (small.hi90 - small.lo90) > 2 * (large.hi90 - large.lo90)
    assert abs(large.mean - 3.0) < 0.5


def test_no_effect_gives_an_interval_around_zero():
    days, base = simulate(40, [0, 0, 0], seed=4)
    for e in rd.fit(days, base).effects:
        assert e.lo90 < 0 < e.hi90


def test_intervals_are_calibrated():
    rd_draws = rd.DRAWS
    rd.DRAWS = 3000
    try:
        hits = total = 0
        for seed in range(60):
            rng = random.Random(500 + seed)
            truth = [rng.gauss(0, 1) for _ in range(3)]  # drawn from the prior
            days, base = simulate(25, truth, seed=900 + seed)
            for e, t in zip(rd.fit(days, base).effects, truth, strict=True):
                hits += e.lo90 <= t <= e.hi90
                total += 1
        assert 0.82 <= hits / total <= 0.97  # 90% intervals
    finally:
        rd.DRAWS = rd_draws


def test_expected_today_follows_the_inputs():
    days, base = simulate(60, [0, 0, 1.5], seed=5)
    f = rd.fit(days, base)
    good = f.expected_today({"recovery_score": 60, "hrv_rmssd_ms": 70, "sleep_hours": 8.5})
    bad = f.expected_today({"recovery_score": 60, "hrv_rmssd_ms": 70, "sleep_hours": 5.5})
    assert good[0] > 0 > bad[0]
    assert f.expected_today({"recovery_score": 60}) is None


# --- Endpoint ------------------------------------------------------------------


def test_readiness_endpoint(client):
    # Dates in 2024 keep this independent of other test files' data.
    ex = client.post(
        "/api/exercises", json={"name": "Ready Press", "split_day": "chest_bi"}
    ).json()["id"]
    ex2 = client.post(
        "/api/exercises", json={"name": "Ready Curl", "split_day": "chest_bi"}
    ).json()["id"]
    rng = random.Random(11)
    start = date(2024, 1, 1)
    with SessionLocal() as s:
        for i in range(24):
            d = start + timedelta(days=3 * i)
            sleep = rng.gauss(7, 1)
            boost = 1 + 0.02 * (sleep - 7)  # better sleep -> stronger that day
            s.add(WhoopDaily(date=d, recovery_score=rng.gauss(60, 15),
                             hrv_rmssd_ms=rng.gauss(70, 10), sleep_hours=sleep))
            sets = [
                {"exercise_id": ex, "set_number": 1, "weight": round((200 + i) * boost),
                 "reps": 5, "rir": 1},
                {"exercise_id": ex2, "set_number": 1, "weight": round((60 + i / 4) * boost),
                 "reps": 10, "rir": 1},
            ]
            client.post("/api/workouts", json={"date": str(d), "split_day": "chest_bi",
                                               "sets": sets})
        s.commit()

    r = client.get("/api/lab/readiness", params={"today": str(start + timedelta(days=69))})
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "live"
    assert body["days"] >= rd.MIN_DAYS
    assert [e["key"] for e in body["effects"]] == KEYS
    sleep = body["effects"][2]
    assert sleep["mean"] > 0 and sleep["p_positive"] > 0.8
    assert body["today"] is not None

    lab = client.get("/api/lab").json()
    model = next(m for m in lab["models"] if m["key"] == "readiness")
    assert model["status"] == "live" and model["headline"]
