# Kalman filter on estimated 1RM

**Question:** what is my true strength on a lift today, and how sure are we?
**Where:** [`backend/app/strength.py`](../../backend/app/strength.py); served by `GET /api/progress/lift/{id}`; drawn on the Progress tab.

## 1. One number per session

Each set becomes an estimated 1-rep max with Epley's formula, treating a set with reps in reserve as if it were taken to failure:

$$
\text{e1RM} = w\left(1 + \frac{r + \text{RIR}}{30}\right)
$$

A session's observation $y_t$ is its **best** set's e1RM for that lift. (The second set is usually done more fatigued, so it reads systematically low.)

## 2. State-space model

Strength $x_t$ is hidden and drifts slowly; each session is a noisy reading of it:

$$
\begin{aligned}
x_t &= x_{t-1} + w_t, & w_t &\sim \mathcal N(0,\; q\,\Delta t)\\
y_t &= x_t + v_t, & v_t &\sim \mathcal N(0,\; r)
\end{aligned}
$$

- $\Delta t$ is the number of days since the previous session, so after a two-week break the model is less sure where you are.
- $r$ captures everything that makes a single day misleading: sleep, warm-up, the Epley approximation itself.
- $q$ captures how fast true strength can move.

## 3. The filter

Starting from the first session ($\hat x_1 = y_1$, $P_1 = r$), each new session runs two steps:

| Step | Equations | Meaning |
|---|---|---|
| Predict | $\hat x^- = \hat x_{t-1},\quad P^- = P_{t-1} + q\,\Delta t$ | strength probably didn't change, but we're less sure |
| Update | $K = \dfrac{P^-}{P^- + r},\quad \hat x_t = \hat x^- + K\,(y_t - \hat x^-),\quad P_t = (1-K)P^-$ | blend in today's reading, weighted by how trustworthy it is |

The **Kalman gain** $K$ is the whole idea: if sessions are noisy ($r$ large), $K$ is small and one great day barely moves the estimate. If strength moves fast ($q$ large), $K$ is large and the estimate follows the readings.

The 95% band on the chart is $\hat x_t \pm 1.96\sqrt{P_t}$.

## 4. Fitting $q$ and $r$ by maximum likelihood

Each prediction implies a distribution for the next reading, $y_t \sim \mathcal N(\hat x^-, P^- + r)$, so the log-likelihood of the whole history is

$$
\ell(q, r) = -\tfrac12 \sum_t \left[\log\!\big(2\pi S_t\big) + \frac{(y_t - \hat x^-_t)^2}{S_t}\right], \qquad S_t = P^-_t + r .
$$

The app maximizes this over a 24 × 24 log-spaced grid of *relative* noise levels (session noise 0.5–12% of the lift's level; drift 0.02–3% per √day), so one grid works for both a curl and a squat. With fewer than 6 sessions it uses defaults (3% noise, ~1%/week drift) instead of fitting.

**Why a grid and not an optimizer?** Two parameters, a few hundred observations, and no SciPy in the serverless bundle (faster cold starts). The grid is easy to reason about and can't get stuck in a local optimum.

## 5. Validation

`backend/tests/test_strength.py` simulates lifters with known noise and drift and checks that:

- the MLE recovers the true session noise (3%) to within about ±1 percentage point on average;
- the filtered estimate is much closer to the true strength than the raw readings are (mean squared error less than 60% of raw);
- the 95% band actually contains the true value 85–99% of the time.

## Plateau detection

Over the last 6 weeks, fit an ordinary least-squares line to the session e1RMs and compute a 95% confidence interval for the slope using the t distribution:

$$
\hat\beta \pm t_{0.975,\,n-2}\; \frac{s}{\sqrt{\sum (d_i - \bar d)^2}}
$$

reported as % of the lift per week. Four outcomes, needing at least 4 sessions:

| Status | Rule | Reading |
|---|---|---|
| **Improving** | whole CI > 0 | confidently going up |
| **Declining** | whole CI < 0 | confidently going down |
| **Plateau** | CI contains 0 *and* lies within ±1%/week | confidently flat |
| **Unclear** | CI contains 0 but is wider than ±1%/week | not enough evidence either way |

The split between *plateau* and *unclear* matters: a wide interval that happens to include zero is absence of evidence of progress, not evidence of a plateau. (This is the logic of an equivalence test, TOST, rather than a plain significance test.)

## Interview talking points

- This is the same machinery used in trading to estimate a time-varying hedge ratio, or to filter a noisy price into a "fair value" signal.
- The design choice that matters is $q/r$, the signal-to-noise ratio. Fitting it by likelihood rather than hand-tuning is the difference between a filter and a moving average.
- Planned extension: RTS smoothing for a better historical curve, and a local linear trend model (a state for strength *and* for its rate of change).
