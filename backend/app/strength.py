"""Strength analytics: e1RM, a Kalman filter on e1RM, and plateau detection.

Pure Python on purpose: the data is small (hundreds of sessions), and keeping
NumPy/SciPy out of the serverless bundle keeps the API fast to cold-start.
The equations are written up in docs/math/kalman-e1rm.md.
"""

import math
from dataclasses import dataclass
from datetime import date

# --- Estimated 1-rep max ----------------------------------------------------


def e1rm(weight: float, reps: int, rir: int | None = None) -> float:
    """Epley estimate, treating the set as if taken to failure at reps + RIR.

    Unknown RIR is treated as 0 (a hard set), which matches how most sets in
    this program are run.
    """
    total = reps + (rir or 0)
    if total <= 1:
        return float(weight)
    return weight * (1 + total / 30)


# --- Kalman filter ----------------------------------------------------------
#
# State:        x_t = x_{t-1} + w_t,   w_t ~ N(0, q * dt)    (strength drifts)
# Observation:  y_t = x_t + v_t,       v_t ~ N(0, r)         (a session's best e1RM)
#
# dt is days since the previous session, so uncertainty grows during breaks.
# q and r are chosen by maximum likelihood over the lift's own history.

Z95 = 1.959964


@dataclass(frozen=True)
class Obs:
    day: date
    value: float  # best e1RM of the session


@dataclass(frozen=True)
class FilterPoint:
    day: date
    observed: float
    mean: float  # filtered estimate after seeing this session
    sd: float

    @property
    def lower(self) -> float:
        return self.mean - Z95 * self.sd

    @property
    def upper(self) -> float:
        return self.mean + Z95 * self.sd


@dataclass(frozen=True)
class KalmanFit:
    points: list[FilterPoint]
    q: float  # process variance per day (lb^2/day)
    r: float  # measurement variance (lb^2)
    loglik: float | None
    fitted: bool  # False = too little data, defaults used

    @property
    def noise_pct(self) -> float:
        """Session-to-session noise (1 SD) as % of the current level."""
        return 100 * math.sqrt(self.r) / self.points[-1].mean

    @property
    def drift_pct_per_week(self) -> float:
        """How far true strength can move in a week (1 SD) as % of level."""
        return 100 * math.sqrt(self.q * 7) / self.points[-1].mean

    def predict(self, day: date) -> tuple[float, float]:
        """Estimate and SD for a later day (no new data, so the band widens)."""
        last = self.points[-1]
        dt = max(0, (day - last.day).days)
        return last.mean, math.sqrt(last.sd**2 + self.q * dt)


def _run(obs: list[Obs], q: float, r: float) -> tuple[list[FilterPoint], float]:
    x, p = obs[0].value, r  # start at the first observation, as uncertain as one session
    points = [FilterPoint(obs[0].day, obs[0].value, x, math.sqrt(p))]
    loglik = 0.0
    for prev, cur in zip(obs, obs[1:], strict=False):
        dt = max(1, (cur.day - prev.day).days)
        # Predict
        p_pred = p + q * dt
        # Update
        s = p_pred + r  # innovation variance
        innov = cur.value - x
        k = p_pred / s  # Kalman gain: how much to trust this session vs the estimate
        x = x + k * innov
        p = (1 - k) * p_pred
        loglik += -0.5 * (math.log(2 * math.pi * s) + innov**2 / s)
        points.append(FilterPoint(cur.day, cur.value, x, math.sqrt(p)))
    return points, loglik


# Defaults when there's too little history to fit: 3% session noise and
# 0.4% per sqrt(day) drift, i.e. ~1% per week. Typical for an intermediate lifter.
DEFAULT_NOISE = 0.03
DEFAULT_DRIFT = 0.004
MIN_OBS_TO_FIT = 6


def _logspace(lo: float, hi: float, n: int) -> list[float]:
    a, b = math.log(lo), math.log(hi)
    return [math.exp(a + (b - a) * i / (n - 1)) for i in range(n)]


def fit_kalman(obs: list[Obs], grid: int = 24) -> KalmanFit:
    """Filter a lift's history, choosing q and r by maximum likelihood.

    The search is a log-spaced grid over *relative* noise levels (as a
    fraction of the lift's typical e1RM), so the same grid works for a 95 lb
    curl and a 405 lb squat. A 2-parameter grid is plenty here and avoids a
    SciPy dependency.
    """
    if not obs:
        raise ValueError("no observations")
    obs = sorted(obs, key=lambda o: o.day)
    level = sum(o.value for o in obs) / len(obs)
    if level <= 0:
        raise ValueError("e1RM observations must be positive")

    if len(obs) < MIN_OBS_TO_FIT:
        q = (DEFAULT_DRIFT * level) ** 2
        r = (DEFAULT_NOISE * level) ** 2
        points, ll = _run(obs, q, r)
        return KalmanFit(points, q, r, ll if len(obs) > 1 else None, fitted=False)

    best: tuple[float, float, float] | None = None
    for noise in _logspace(0.005, 0.12, grid):
        r = (noise * level) ** 2
        for drift in _logspace(0.0002, 0.03, grid):
            q = (drift * level) ** 2
            _, ll = _run(obs, q, r)
            if best is None or ll > best[0]:
                best = (ll, q, r)
    assert best is not None
    ll, q, r = best
    points, _ = _run(obs, q, r)
    return KalmanFit(points, q, r, ll, fitted=True)


# --- Plateau detection ------------------------------------------------------

# Two-sided 95% t critical values; beyond 30 df the normal value is close enough.
_T95 = {
    1: 12.706, 2: 4.303, 3: 3.182, 4: 2.776, 5: 2.571, 6: 2.447, 7: 2.365, 8: 2.306,
    9: 2.262, 10: 2.228, 12: 2.179, 15: 2.131, 20: 2.086, 25: 2.060, 30: 2.042,
}


def t95(df: int) -> float:
    if df <= 0:
        return math.inf
    keys = sorted(k for k in _T95 if k <= df)
    return _T95[keys[-1]] if df <= 30 else Z95


@dataclass(frozen=True)
class Trend:
    status: str  # "improving" | "plateau" | "declining" | "unclear" | "not_enough_data"
    pct_per_week: float | None  # slope as % of level per week
    ci_low: float | None
    ci_high: float | None
    sessions: int
    window_days: int


PLATEAU_WINDOW_DAYS = 42
PLATEAU_MIN_SESSIONS = 4
# A lift only counts as plateaued if we're confident the weekly trend is within
# this many % of zero. A wide interval that merely *includes* zero is "unclear":
# absence of evidence of progress isn't evidence of a plateau.
PLATEAU_BAND_PCT_WEEK = 1.0


def trend(obs: list[Obs], today: date, window_days: int = PLATEAU_WINDOW_DAYS) -> Trend:
    """OLS slope of e1RM over the last `window_days`, with a 95% CI.

    - improving / declining: the whole 95% CI is above / below zero
    - plateau: the CI includes zero AND sits inside +/-PLATEAU_BAND_PCT_WEEK,
      so we're confident the lift is roughly flat
    - unclear: the CI includes zero but is too wide to call it flat
    """
    recent = [o for o in obs if 0 <= (today - o.day).days <= window_days]
    n = len(recent)
    if n < PLATEAU_MIN_SESSIONS:
        return Trend("not_enough_data", None, None, None, n, window_days)

    xs = [(o.day - recent[0].day).days for o in recent]
    ys = [o.value for o in recent]
    mx, my = sum(xs) / n, sum(ys) / n
    sxx = sum((x - mx) ** 2 for x in xs)
    if sxx == 0:
        return Trend("not_enough_data", None, None, None, n, window_days)
    slope = sum((x - mx) * (y - my) for x, y in zip(xs, ys, strict=True)) / sxx
    resid = [y - (my + slope * (x - mx)) for x, y in zip(xs, ys, strict=True)]
    se = math.sqrt(sum(e * e for e in resid) / (n - 2) / sxx) if n > 2 else math.inf
    half = t95(n - 2) * se

    to_pct_week = 100 * 7 / my
    lo, hi = (slope - half) * to_pct_week, (slope + half) * to_pct_week
    if lo > 0:
        status = "improving"
    elif hi < 0:
        status = "declining"
    elif -PLATEAU_BAND_PCT_WEEK <= lo and hi <= PLATEAU_BAND_PCT_WEEK:
        status = "plateau"
    else:
        status = "unclear"
    return Trend(status, slope * to_pct_week, lo, hi, n, window_days)
