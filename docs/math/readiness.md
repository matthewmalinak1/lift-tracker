# Bayesian readiness model

**Question:** do recovery, HRV and sleep change how strong I am on a given day, and by how much?
**Where:** [`backend/app/readiness.py`](../../backend/app/readiness.py); served by `GET /api/lab/readiness`; shown in the Lab tab.

## 1. Outcome: how surprised was the strength model?

Long-term progress would swamp any day-to-day effect, so the outcome is not raw strength. It is the **surprise** relative to the trend Kalman filter ([kalman-e1rm.md](kalman-e1rm.md), section 4b):

$$
s_{d,\ell} = 100 \cdot \frac{y_{d,\ell} - \hat y_{d,\ell}}{\hat y_{d,\ell}}
$$

where $y_{d,\ell}$ is the best e1RM for lift $\ell$ on day $d$ and $\hat y_{d,\ell}$ is the filter's forecast made **using only earlier sessions** (the walk-forward backtest's predictions). So there is no look-ahead: the forecast never saw that day.

Each lifting day becomes one row, the average surprise across that day's lifts:

$$
y_d = \frac{1}{w_d}\sum_\ell s_{d,\ell}, \qquad w_d = \text{number of lifts forecast that day.}
$$

A day with 6 lifts measures "how strong was I today" better than a day with 2, which the model uses as a weight.

## 2. Inputs: relative to *your* normal

That morning's WHOOP recovery %, HRV (RMSSD, ms) and sleep hours, each as a z-score against your own WHOOP history:

$$
z_{d,j} = \frac{x_{d,j} - \bar x_j}{\text{sd}(x_j)}
$$

so an effect reads as "% stronger when this input is one standard deviation above my usual." The card shows the size of 1 SD in raw units (e.g. 10 ms of HRV).

## 3. Model

Weighted Bayesian linear regression:

$$
y_d = \alpha + \beta^\top z_d + \varepsilon_d, \qquad \varepsilon_d \sim \mathcal N\!\left(0,\ \sigma^2 / w_d\right)
$$

with a conjugate **normal–inverse-gamma** prior:

$$
\theta = (\alpha, \beta) \mid \sigma^2 \sim \mathcal N(0,\ \sigma^2 V_0), \qquad \sigma^2 \sim \text{Inv-Gamma}(a_0, b_0).
$$

$\sigma$ is the noise of a single lift's surprise; averaging $w_d$ lifts divides its variance by $w_d$.

### Priors (fixed before seeing results)

| Parameter | Prior | Meaning |
|---|---|---|
| $\sigma^2$ | Inv-Gamma(2, 9) | prior mean $\sigma^2 = 9$, i.e. a single lift's surprise is about ±3% |
| $\beta_j$ | $V_0 = 1/9$ | prior SD $\approx \sigma/3 \approx 1\%$ per SD of input, centred on **zero** |
| $\alpha$ | $V_0 = 1$ | prior SD $\approx 3\%$; absorbs any leftover bias in the forecasts |

The effect prior is **skeptical**: before any data, a 1-SD better night of sleep is expected to change strength by 0 ± 1%. Effects of a few percent are possible, but the data has to show them. With a small sample this matters: it stops three lucky days from turning into "sleep = +8%".

### Posterior (closed form)

With $X$ the design matrix (a column of ones plus the z-scores) and $W = \text{diag}(w_d)$:

$$
\Lambda_n = V_0^{-1} + X^\top W X, \qquad m_n = \Lambda_n^{-1} X^\top W y
$$

$$
a_n = a_0 + \tfrac{n}{2}, \qquad b_n = b_0 + \tfrac12\left(y^\top W y - m_n^\top \Lambda_n m_n\right)
$$

so $\sigma^2 \mid y \sim \text{Inv-Gamma}(a_n, b_n)$ and $\theta \mid \sigma^2, y \sim \mathcal N(m_n,\ \sigma^2 \Lambda_n^{-1})$.

The posterior mean $m_n$ is a precision-weighted blend of the prior (zero) and the weighted least-squares estimate. With little data it sits near zero; as days accumulate it converges to the data's own estimate. That is the "skeptical prior" in one line.

**Reported:** for each input, the posterior mean, a 90% credible interval and $P(\beta_j > 0)$. These come from 20,000 Monte Carlo draws (draw $\sigma^2$, then $\theta$ via a Cholesky factor of $\Lambda_n^{-1}$), with a fixed seed so the numbers don't jitter between page loads. Pure Python: a 4 × 4 problem needs no NumPy.

**Today's forecast:** for this morning's WHOOP inputs $z^*$, the expected surprise is $\alpha + \beta^\top z^*$, summarized over the same draws.

## 4. Validation

`backend/tests/test_readiness.py` simulates lifters with known effects and checks that:

- a real effect (+1.5% per SD of sleep, 60 days) is recovered, with the truth inside the 90% interval and $P(>0) > 0.99$;
- with no effect, every 90% interval contains zero;
- small samples are shrunk: intervals at 8 days are more than twice as wide as at 80;
- **calibration:** across 60 simulated lifters whose true effects are drawn from the prior, the 90% intervals contain the truth 82–97% of the time (89% in a 150-run check);
- the endpoint returns a positive sleep effect when sleep is built into the data.

## 5. Limits (say these in an interview before anyone asks)

- **Correlation, not causation.** A late night out can cut sleep *and* focus. The model measures association.
- **Three inputs, three chances to be fooled.** With 90% intervals, the chance that at least one of three null effects looks "real" is about 1 − 0.9³ ≈ 27%. On simulated data with a true sleep effect only, recovery once showed a "97% hurts" signal with zero true effect. Early on, treat one-off strong signals as hypotheses.
- **Collinear inputs.** WHOOP's recovery score is partly computed from HRV and sleep, so their separate effects are hard to tell apart. The posterior handles this honestly (wider, correlated intervals) but the split between them is less reliable than their combined effect.
- **The outcome inherits the strength model's errors.** If the trend filter is biased, the intercept absorbs it; if its noise is mis-estimated, that only affects the forecasts, not this regression's own noise estimate.
- **RIR is self-reported**, so the e1RM outcome has measurement noise of its own.

## Interview talking points

- "I regress the strength model's one-step-ahead surprises on standardized WHOOP inputs, so long-term progress is already removed and only day-to-day variation is explained."
- "Because the sample is small, I used a conjugate Bayesian regression with skeptical priors centred on zero. The posterior mean is a precision-weighted blend of 'no effect' and the data, and I report credible intervals and P(effect > 0) instead of p-values."
- "I checked calibration by simulation: 90% intervals cover the truth about 89% of the time."
- "With three inputs, a 27% chance of at least one false signal is exactly why I don't trust single strong results early on." This is the same multiple-testing problem as screening many trading signals.
