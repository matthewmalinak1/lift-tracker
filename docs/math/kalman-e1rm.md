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

## 4b. Local linear trend model (the one the app uses)

The model above has no direction: its forecast for the next session is "where you are now", built from a weighted average of past sessions. For a lifter who keeps getting stronger, that average always trails behind. The walk-forward backtest (section 6) caught this on real data: the random-walk filter's error was **38% worse than naive**. Simulations reproduce it: a lifter gaining ~1% per session with ~1% session noise makes the random-walk filter lose to naive by about a third.

The fix is a second hidden state, the **rate of gain** $b$ (lb/day):

$$
\begin{aligned}
L_t &= L_{t-1} + b_{t-1}\,\Delta t + w_t, & w_t &\sim \mathcal N(0,\; q_L\,\Delta t)\\
b_t &= b_{t-1} + u_t, & u_t &\sim \mathcal N(0,\; q_b\,\Delta t)\\
y_t &= L_t + v_t, & v_t &\sim \mathcal N(0,\; r)
\end{aligned}
$$

In matrix form the state is $s_t = (L_t, b_t)^\top$ with transition $F = \begin{pmatrix}1 & \Delta t\\ 0 & 1\end{pmatrix}$ and observation $H = (1,\ 0)$. Because the slope noise also accumulates into the level over a gap, the process covariance is

$$
Q(\Delta t) = \begin{pmatrix} q_L\Delta t + q_b\Delta t^3/3 & q_b\Delta t^2/2 \\ q_b\Delta t^2/2 & q_b\Delta t \end{pmatrix}.
$$

The filter is the same two steps in two dimensions: $\hat s^- = F\hat s$, $P^- = FPF^\top + Q$, then $K = P^-H^\top / (HP^-H^\top + r)$, $\hat s = \hat s^- + K(y_t - \hat L^-)$, $P = (I - KH)P^-$. The forecast for the next session is $\hat L + \hat b\,\Delta t$: **where you're heading, not where you've been.**

- **Initial slope:** $b_0 = 0$ with prior SD 0.5% of the lift per day (~3.5%/week), weak enough that a few sessions pin it down.
- **Fitting:** $q_L$, $q_b$ and $r$ by maximum likelihood over a 10 × 10 × 10 log grid (8³ inside the backtest for speed). Defaults below 6 sessions.
- **Output:** the slope state gives a live estimate of your rate of gain, with its own uncertainty.

**The trade-off.** One extra state means one more thing to estimate from a short history. On simulated lifters with 9 weekly sessions:

| Simulated lifter | Trend filter vs naive | No-trend filter vs naive |
|---|---|---|
| Flat, 1% noise | −2% | +19% |
| Flat, 3% noise | +1% | +28% |
| +1%/session, 1% noise | **+6%** | −34% |
| +2%/session, 1% noise | **+37%** | −54% |
| +2%/session, 3% noise | +5% | −19% |

(Positive = smaller error than naive.) The trend model gives up a little on lifters who are flat and fixes the large failure on lifters who are progressing. The no-trend filter stays in the backtest as a benchmark, so the Lab card always shows all three.

**Honesty rule:** the model design (structure, priors, grid) was fixed for the reason above, and checked on simulations only, *before* rerunning the backtest on real data. Changing it again until it wins on the same history would be overfitting to the test set.

## 5. Validation

`backend/tests/test_strength.py` simulates lifters with known noise and drift and checks that:

- the MLE recovers the true session noise (3%) to within about ±1 percentage point on average;
- the filtered estimate is much closer to the true strength than the raw readings are (mean squared error less than 60% of raw);
- the 95% band actually contains the true value 85–99% of the time.

## 6. Walk-forward backtest

The checks above use simulated lifters. The backtest ([`backend/app/backtest.py`](../../backend/app/backtest.py), shown in the Lab tab) runs on **real history**:

1. For each lift, start once it has 3 sessions.
2. For session $t$, fit the parameters by MLE using **only sessions $1..t-1$** (refit every 3 steps), filter them, and predict session $t$ with the trend filter:
   $$\hat y_t = \hat L_{t-1} + \hat b_{t-1}\Delta t, \qquad \operatorname{Var}(y_t) = H\,P^-_t H^\top + r$$
   The prediction variance includes $r$, because we're predicting a noisy *reading*, not the hidden strength.
3. Compare against two benchmarks: the no-trend filter from section 2 ($\hat y_t = \hat x_{t-1}$), and a naive forecast, $\hat y_t^{\text{naive}} = y_{t-1}$ ("same as last session").
4. Pool every prediction across lifts and report:

| Metric | Definition | Why it matters |
|---|---|---|
| Coverage | share of $y_t$ inside $\hat y_t \pm 1.96\sqrt{\operatorname{Var}}$ | calibration: should be ≈ 95% |
| Band width | average $1.96\sqrt{\operatorname{Var}} / \hat y_t$ | coverage is trivial with huge bands; this keeps it honest |
| MAE % | average $|y_t - \hat y_t| / y_t$ for trend filter, no-trend filter and naive | accuracy, and whether the filter beats the obvious baselines |

There is no look-ahead: a test asserts that changing a future session never changes an earlier prediction.

**What to expect:** with only a few sessions per lift, coverage tends to come in a little under 95%. The noise parameters are estimated from little data and the band ignores that estimation uncertainty, so it is slightly overconfident early on. On simulated lifters, coverage rises from about 86% at 10 sessions per lift to about 91% at 60. A full Bayesian treatment of $q$ and $r$ would close the gap.

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
- The first version lost to "same as last session" by 38% on real data. The backtest exposed it, simulations explained it (no trend term, so it lags a progressing lifter), and the fix was a local linear trend state. The failed model is kept as a benchmark.
- Planned extension: RTS smoothing for a better historical curve, and pooling the noise parameters across lifts so short histories borrow strength from each other.
