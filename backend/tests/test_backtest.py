import random
from datetime import date, timedelta

from app.backtest import summarize, walk_forward
from app.strength import Obs

START = date(2026, 1, 1)


def lifter(n, noise_pct, gain_pct_week, seed, level=250.0):
    rng = random.Random(seed)
    out, x = [], level
    for i in range(n):
        x *= 1 + gain_pct_week / 100 * 3 / 7 + rng.gauss(0, 0.003)
        out.append(Obs(START + timedelta(days=3 * i), x * (1 + rng.gauss(0, noise_pct / 100))))
    return out


def test_no_lookahead_and_counts():
    obs = lifter(10, 3, 0.5, seed=1)
    preds = walk_forward(1, obs)
    assert len(preds) == 10 - 3
    # The naive forecast is always the previous session's reading
    assert [p.naive for p in preds] == [o.value for o in obs[2:-1]]
    # Changing a future session can't change an earlier prediction
    altered = obs[:8] + [Obs(obs[8].day, obs[8].value * 2), obs[9]]
    assert walk_forward(1, altered)[:5] == preds[:5]


def test_bands_are_calibrated_and_filter_beats_naive_on_noisy_data():
    preds = []
    for seed in range(12):
        preds += walk_forward(seed, lifter(30, 4, 0.5, seed=seed))
    s = summarize(preds)
    assert s.predictions == 12 * 27
    assert 0.85 <= s.coverage_95 <= 0.99
    assert s.improvement_pct > 15  # smoothing beats "same as last time"


def test_summary_of_nothing():
    s = summarize([])
    assert s.predictions == 0 and s.coverage_95 is None
