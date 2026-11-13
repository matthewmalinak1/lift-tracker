"""Walk-forward backtest of the Kalman e1RM filter on real training history.

For every lift and every session after the first few, the filter is fitted
using ONLY the sessions before it, then asked to predict that session. Nothing
from the future leaks into a prediction, so these are honest out-of-sample
results.

Three forecasts are compared for every session:
  * trend filter: the local linear trend Kalman filter (level + rate of gain),
    forecasting L + b*dt. This is the model the app uses.
  * level-only filter: the original random-walk Kalman filter, kept as a
    benchmark. It has no trend term, so it lags a lifter who keeps progressing.
  * naive: "same as last session".

Reported (pooled across all lifts):
  * coverage of the trend filter's 95% prediction band (target: 95%)
  * average band half-width as % of the lift (tight bands are the hard part)
  * mean absolute % error of each forecast, and the trend filter's improvement
    over naive

The prediction band is for the next *observation*, so its variance includes
both the state uncertainty carried forward dt days and the session noise r.
"""

import math
from dataclasses import dataclass
from datetime import date

from .strength import (
    SLOPE_PRIOR_SD,
    Z95,
    Obs,
    TrendKalmanFit,
    _run,
    _run_trend,
    _trend_forecast,
    fit_kalman,
    fit_trend_kalman,
)

MIN_HISTORY = 3  # sessions of a lift before we start predicting it
REFIT_EVERY = 3  # refit q and r every few steps to keep the backtest fast
GRID = 12  # coarser MLE grids than the live fits; results are insensitive to them
TREND_GRID = 8


@dataclass(frozen=True)
class Prediction:
    exercise_id: int
    actual: float
    predicted: float
    sd: float
    naive: float
    level_only: float  # random-walk filter's forecast, as a benchmark
    day: date | None = None  # date of the predicted session

    @property
    def covered(self) -> bool:
        return abs(self.actual - self.predicted) <= Z95 * self.sd

    @property
    def band_pct(self) -> float:
        return 100 * Z95 * self.sd / self.predicted

    @property
    def err_pct(self) -> float:
        return 100 * abs(self.actual - self.predicted) / self.actual

    @property
    def naive_err_pct(self) -> float:
        return 100 * abs(self.actual - self.naive) / self.actual

    @property
    def level_only_err_pct(self) -> float:
        return 100 * abs(self.actual - self.level_only) / self.actual


def walk_forward(exercise_id: int, obs: list[Obs]) -> list[Prediction]:
    obs = sorted(obs, key=lambda o: o.day)
    preds: list[Prediction] = []
    params = None
    for t in range(MIN_HISTORY, len(obs)):
        history = obs[:t]
        if params is None or (t - MIN_HISTORY) % REFIT_EVERY == 0:
            rw = fit_kalman(history, grid=GRID)
            tr = fit_trend_kalman(history, grid=TREND_GRID)
            params = (rw.q, rw.r, tr.q_level, tr.q_slope, tr.r)
        q, r, q_level, q_slope, r_trend = params
        dt = max(1, (obs[t].day - history[-1].day).days)

        # Trend filter: rerun on the history with the current parameters, then
        # project level + slope * dt forward.
        tr_fit = fit_trend_kalman_with(history, q_level, q_slope, r_trend)
        last = tr_fit.points[-1]
        mean, var = _trend_forecast(
            last.mean, tr_fit.slopes[-1][0], tr_fit.cov, dt, q_level, q_slope
        )
        sd = math.sqrt(var + r_trend)

        rw_mean, _ = filtered_last(history, q, r)
        preds.append(
            Prediction(
                exercise_id, obs[t].value, mean, sd, history[-1].value, rw_mean, obs[t].day
            )
        )
    return preds


def fit_trend_kalman_with(
    obs: list[Obs], q_level: float, q_slope: float, r: float
) -> TrendKalmanFit:
    """Trend filter on `obs` with fixed parameters (no refit)."""
    level = sum(o.value for o in obs) / len(obs)
    fit, _ = _run_trend(obs, q_level, q_slope, r, (SLOPE_PRIOR_SD * level) ** 2)
    return fit


def filtered_last(obs: list[Obs], q: float, r: float) -> tuple[float, float]:
    """Filtered mean and SD after the last observation, for given q and r."""
    points, _ = _run(obs, q, r)
    return points[-1].mean, points[-1].sd


@dataclass(frozen=True)
class Summary:
    predictions: int
    lifts: int
    coverage_95: float | None
    band_pct: float | None
    mae_pct: float | None
    naive_mae_pct: float | None
    level_only_mae_pct: float | None
    improvement_pct: float | None


def summarize(preds: list[Prediction]) -> Summary:
    n = len(preds)
    if n == 0:
        return Summary(0, 0, None, None, None, None, None, None)
    mae = sum(p.err_pct for p in preds) / n
    naive = sum(p.naive_err_pct for p in preds) / n
    return Summary(
        predictions=n,
        lifts=len({p.exercise_id for p in preds}),
        coverage_95=sum(p.covered for p in preds) / n,
        band_pct=sum(p.band_pct for p in preds) / n,
        mae_pct=mae,
        naive_mae_pct=naive,
        level_only_mae_pct=sum(p.level_only_err_pct for p in preds) / n,
        improvement_pct=100 * (naive - mae) / naive if naive > 0 else None,
    )
