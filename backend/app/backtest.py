"""Walk-forward backtest of the Kalman e1RM filter on real training history.

For every lift and every session after the first few, the filter is fitted
using ONLY the sessions before it, then asked to predict that session. Nothing
from the future leaks into a prediction, so these are honest out-of-sample
results.

Reported (pooled across all lifts):
  * coverage of the 95% prediction band (target: 95%)
  * average band half-width as % of the lift (tight bands are the hard part)
  * mean absolute % error of the filter vs a naive "same as last session"
    forecast, and the improvement between them

The prediction band is for the next *observation*, so its variance includes
both the state uncertainty and the session noise: P + q*dt + r.
"""

import math
from dataclasses import dataclass

from .strength import Z95, Obs, _run, fit_kalman

MIN_HISTORY = 3  # sessions of a lift before we start predicting it
REFIT_EVERY = 3  # refit q and r every few steps to keep the backtest fast
GRID = 12  # coarser MLE grid than the live fit; results are insensitive to it


@dataclass(frozen=True)
class Prediction:
    exercise_id: int
    actual: float
    predicted: float
    sd: float
    naive: float

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


def walk_forward(exercise_id: int, obs: list[Obs]) -> list[Prediction]:
    obs = sorted(obs, key=lambda o: o.day)
    preds: list[Prediction] = []
    fit = None
    for t in range(MIN_HISTORY, len(obs)):
        history = obs[:t]
        if fit is None or (t - MIN_HISTORY) % REFIT_EVERY == 0:
            fit = fit_kalman(history, grid=GRID)
            q, r = fit.q, fit.r
        # Filter the history with the current parameters, then predict session t.
        mean, state_sd = filtered_last(history, q, r)
        dt = max(1, (obs[t].day - history[-1].day).days)
        sd = math.sqrt(state_sd**2 + q * dt + r)
        preds.append(Prediction(exercise_id, obs[t].value, mean, sd, history[-1].value))
    return preds


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
    improvement_pct: float | None


def summarize(preds: list[Prediction]) -> Summary:
    n = len(preds)
    if n == 0:
        return Summary(0, 0, None, None, None, None, None)
    mae = sum(p.err_pct for p in preds) / n
    naive = sum(p.naive_err_pct for p in preds) / n
    return Summary(
        predictions=n,
        lifts=len({p.exercise_id for p in preds}),
        coverage_95=sum(p.covered for p in preds) / n,
        band_pct=sum(p.band_pct for p in preds) / n,
        mae_pct=mae,
        naive_mae_pct=naive,
        improvement_pct=100 * (naive - mae) / naive if naive > 0 else None,
    )
