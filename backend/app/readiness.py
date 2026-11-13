"""Bayesian readiness model: do recovery, HRV and sleep move day-to-day strength?

Outcome (one row per lifting day with WHOOP data):
    y_d = average over that day's lifts of 100 * (actual - predicted) / predicted
where "predicted" is the trend Kalman filter's one-step-ahead forecast made
using only earlier sessions (the walk-forward backtest's predictions). So y_d
is how much stronger or weaker you were than the model expected, in %.
Long-term progress is already in the forecast, so only day-to-day swings
are left to explain.

Predictors: that morning's recovery %, HRV and sleep hours, each turned into a
z-score against your own WHOOP history ("1 SD above your usual").

Model (weighted Bayesian linear regression, conjugate normal-inverse-gamma):
    y_d = a + b . z_d + e_d,     e_d ~ N(0, s^2 / w_d)
    (a, b) | s^2 ~ N(0, s^2 * V0),   s^2 ~ InvGamma(A0, B0)
w_d is the number of lifts that day (more lifts = a better measured day).

Priors are skeptical and set before looking at any results:
  * each effect b_j: prior SD ~1% per SD of the input (V0 = 1/9 with s ~ 3%),
    centered on zero, so the data has to earn any effect it finds;
  * intercept a (average surprise, i.e. leftover forecast bias): prior SD ~3%;
  * noise s: InvGamma(2, 9) in %^2 units, i.e. prior mean of s^2 = 9 (s ~ 3%).

Posterior is closed form; intervals and P(effect > 0) come from Monte Carlo
draws of (s^2, b) with a fixed seed. Pure Python, no NumPy/SciPy.
Write-up: docs/math/readiness.md.
"""

import math
import random
from dataclasses import dataclass
from datetime import date
from statistics import mean, pstdev

FACTORS: list[tuple[str, str, str]] = [
    # key, label, unit of the raw input
    ("recovery_score", "Recovery", "%"),
    ("hrv_rmssd_ms", "HRV", "ms"),
    ("sleep_hours", "Sleep", "h"),
]

PRIOR_EFFECT_V = 1 / 9  # effect prior SD = s * 1/3, i.e. ~1% when s ~ 3%
PRIOR_INTERCEPT_V = 1.0  # intercept prior SD = s, i.e. ~3%
PRIOR_A, PRIOR_B = 2.0, 9.0  # s^2 ~ InvGamma(2, 9): prior mean 9 (%^2)
MIN_DAYS = 8  # below this, report nothing (4 coefficients need some data)
DRAWS = 20_000
SEED = 7


@dataclass(frozen=True)
class Day:
    day: date
    surprise_pct: float  # mean % above/below the forecast across that day's lifts
    lifts: int
    inputs: dict[str, float]  # raw WHOOP values for FACTORS


@dataclass(frozen=True)
class Effect:
    key: str
    label: str
    unit: str
    sd_raw: float  # 1 SD of the raw input, so "per 1 SD" can be shown as e.g. 12 ms
    mean: float  # posterior mean, % strength per 1 SD of the input
    lo90: float
    hi90: float
    p_positive: float
    prior_sd: float  # implied prior SD of the effect, for comparison


@dataclass(frozen=True)
class Fit:
    days: int
    sessions: int
    effects: list[Effect]
    intercept: float  # average surprise, %
    intercept_lo90: float
    intercept_hi90: float
    noise_sd: float  # posterior mean of s, %
    baseline: dict[str, tuple[float, float]]  # key -> (mean, sd) of raw input
    _draws: list[list[float]]  # posterior draws of (a, b1, b2, b3), for forecasts

    def expected_today(self, inputs: dict[str, float]) -> tuple[float, float, float] | None:
        """Expected surprise (%) for a day with these WHOOP inputs, with a 90% interval."""
        z = _z(inputs, self.baseline)
        if z is None:
            return None
        vals = sorted(
            d[0] + sum(b * x for b, x in zip(d[1:], z, strict=True)) for d in self._draws
        )
        return mean(vals), _q(vals, 0.05), _q(vals, 0.95)


# --- Linear algebra for 4x4 (pure Python) ------------------------------------


def _inv(m: list[list[float]]) -> list[list[float]]:
    n = len(m)
    a = [row[:] + [float(i == j) for j in range(n)] for i, row in enumerate(m)]
    for col in range(n):
        piv = max(range(col, n), key=lambda r: abs(a[r][col]))
        a[col], a[piv] = a[piv], a[col]
        p = a[col][col]
        if abs(p) < 1e-12:
            raise ValueError("singular matrix")
        a[col] = [v / p for v in a[col]]
        for r in range(n):
            if r != col and a[r][col] != 0:
                f = a[r][col]
                a[r] = [x - f * y for x, y in zip(a[r], a[col], strict=True)]
    return [row[n:] for row in a]


def _matvec(m: list[list[float]], v: list[float]) -> list[float]:
    return [sum(a * b for a, b in zip(row, v, strict=True)) for row in m]


def _chol(m: list[list[float]]) -> list[list[float]]:
    n = len(m)
    lo = [[0.0] * n for _ in range(n)]
    for i in range(n):
        for j in range(i + 1):
            s = m[i][j] - sum(lo[i][k] * lo[j][k] for k in range(j))
            lo[i][j] = math.sqrt(max(s, 1e-12)) if i == j else s / lo[j][j]
    return lo


def _q(sorted_vals: list[float], p: float) -> float:
    i = min(len(sorted_vals) - 1, max(0, round(p * (len(sorted_vals) - 1))))
    return sorted_vals[i]


# --- Model --------------------------------------------------------------------


def baseline(whoop_rows: list[dict[str, float | None]]) -> dict[str, tuple[float, float]]:
    """Mean and SD of each input over all WHOOP days: your personal 'normal'."""
    out = {}
    for key, _, _ in FACTORS:
        vals = [r[key] for r in whoop_rows if r.get(key) is not None]
        if len(vals) >= 2 and pstdev(vals) > 0:
            out[key] = (mean(vals), pstdev(vals))
    return out


def _z(inputs: dict[str, float], base: dict[str, tuple[float, float]]) -> list[float] | None:
    z = []
    for key, _, _ in FACTORS:
        if key not in base or inputs.get(key) is None:
            return None
        m, sd = base[key]
        z.append((inputs[key] - m) / sd)
    return z


def fit(days: list[Day], base: dict[str, tuple[float, float]]) -> Fit | None:
    rows = []
    for d in days:
        z = _z(d.inputs, base)
        if z is not None:
            rows.append(([1.0, *z], d.surprise_pct, float(d.lifts)))
    if len(rows) < MIN_DAYS:
        return None

    k = 1 + len(FACTORS)
    v0_diag = [PRIOR_INTERCEPT_V] + [PRIOR_EFFECT_V] * len(FACTORS)
    prec0 = [[(1 / v0_diag[i]) if i == j else 0.0 for j in range(k)] for i in range(k)]

    # Posterior precision and mean (prior mean is zero).
    xtwx = [[sum(w * x[i] * x[j] for x, _, w in rows) for j in range(k)] for i in range(k)]
    xtwy = [sum(w * x[i] * y for x, y, w in rows) for i in range(k)]
    prec_n = [[prec0[i][j] + xtwx[i][j] for j in range(k)] for i in range(k)]
    v_n = _inv(prec_n)
    m_n = _matvec(v_n, xtwy)

    ytwy = sum(w * y * y for _, y, w in rows)
    a_n = PRIOR_A + len(rows) / 2
    quad = sum(m * v for m, v in zip(m_n, _matvec(prec_n, m_n), strict=True))
    b_n = PRIOR_B + 0.5 * (ytwy - quad)

    # Monte Carlo: s^2 ~ InvGamma(a_n, b_n), coefficients ~ N(m_n, s^2 V_n).
    rng = random.Random(SEED)
    chol = _chol(v_n)
    draws, sds = [], []
    for _ in range(DRAWS):
        s2 = b_n / rng.gammavariate(a_n, 1.0)
        s = math.sqrt(s2)
        e = [rng.gauss(0, 1) for _ in range(k)]
        coef = [m_n[i] + s * sum(chol[i][j] * e[j] for j in range(i + 1)) for i in range(k)]
        draws.append(coef)
        sds.append(s)

    prior_s = math.sqrt(PRIOR_B / (PRIOR_A - 1))
    effects = []
    for j, (key, label, unit) in enumerate(FACTORS, start=1):
        vals = sorted(d[j] for d in draws)
        effects.append(
            Effect(
                key=key, label=label, unit=unit, sd_raw=base[key][1],
                mean=m_n[j], lo90=_q(vals, 0.05), hi90=_q(vals, 0.95),
                p_positive=sum(v > 0 for v in vals) / len(vals),
                prior_sd=prior_s * math.sqrt(PRIOR_EFFECT_V),
            )
        )
    icpt = sorted(d[0] for d in draws)
    return Fit(
        days=len(rows),
        sessions=int(sum(w for _, _, w in rows)),
        effects=effects,
        intercept=m_n[0],
        intercept_lo90=_q(icpt, 0.05),
        intercept_hi90=_q(icpt, 0.95),
        noise_sd=mean(sds),
        baseline=base,
        _draws=draws[:4000],
    )
