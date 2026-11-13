# The math

This folder documents every model in the app: the assumptions, the equations, and how each one is checked. It is written to be explained out loud in about two minutes per model.

| # | Model | Question it answers | Status |
|---|---|---|---|
| 1 | [Estimated 1RM](#1-estimated-1rm-e1rm) | What does a set of *w* × *r* imply about max strength? | **Live** |
| 2 | [Kalman filter](kalman-e1rm.md) | What is my *true* strength today, and how sure are we? | **Live** (full write-up linked) |
| 3 | [Bayesian readiness model](#3-bayesian-readiness-model) | How much do recovery, HRV and sleep move performance? | **Live**, early estimates ([write-up](readiness.md)) |
| 4 | [Fitness-fatigue model](#4-fitness-fatigue-model) | How do training load, fitness and fatigue add up over time? | Planned (Phase 5) |
| 5 | [Muscle recovery heat map](muscle-recovery.md) | Which muscles are still recovering, and how much? | **v1 live** |

Each section gets its own file with derivations and validation results as it is built.

---

## 1. Estimated 1RM (e1RM)

Every set becomes a noisy measurement of max strength. With reps-in-reserve (RIR) logged, the set is treated as if taken to failure at `reps + RIR`:

$$
\widehat{1RM} = w \left(1 + \frac{r + \text{RIR}}{30}\right) \qquad \text{(Epley)}
$$

The formula gets less accurate as reps go up, so later the measurement noise in the Kalman filter will scale with rep count.

## 2. Kalman filter on e1RM

Strength is a hidden state $x_t$ that drifts slowly; each set gives a noisy observation $y_t$.

$$
\begin{aligned}
x_t &= x_{t-1} + \mu\,\Delta t + w_t, & w_t &\sim \mathcal{N}(0,\; q\,\Delta t) \quad \text{(state: strength drifts)}\\
y_t &= x_t + v_t, & v_t &\sim \mathcal{N}(0,\; R_t) \quad \text{(observation: e1RM from a set)}
\end{aligned}
$$

- $\Delta t$ = days since the last session, so uncertainty widens during long breaks.
- $q$ (process noise) and $R_t$ (measurement noise) are estimated by maximum likelihood over my own history, not hand-picked.
- Output: posterior mean $\hat{x}_t$ and variance $P_t$, giving the 95% band $\hat{x}_t \pm 1.96\sqrt{P_t}$.
- **Current version:** a local linear trend model with a second state for the rate of gain. The first, no-trend version lost to a naive forecast on real data because it lagged steady progress; see [section 4b of the write-up](kalman-e1rm.md#4b-local-linear-trend-model-the-one-the-app-uses).
- The RTS smoother then gives the best estimate of past strength using all data.

## 3. Bayesian readiness model

**Live** (full write-up: [readiness.md](readiness.md)). How far a lifting day lands above or below the trend filter's forecast, explained by that morning's WHOOP data:

$$
y_d = \alpha + \beta_{\text{rec}}\, z(\text{recovery}_d) + \beta_{\text{hrv}}\, z(\text{HRV}_d) + \beta_{\text{sleep}}\, z(\text{sleep}_d) + \varepsilon_d
$$

- $y_d$ is the average % surprise across that day's lifts, against walk-forward (no look-ahead) forecasts.
- Skeptical priors centred on zero effect (SD ~1% per SD of input), so the data has to earn any conclusion.
- Conjugate normal-inverse-gamma posterior in closed form, reported as means, 90% intervals and P(effect > 0).

## 4. Fitness-fatigue model

Banister impulse-response model: performance equals baseline, plus fitness, minus fatigue. Each is an exponentially decaying sum of past training load:

$$
p_t = p_0 + k_1 \sum_{s<t} L_s\, e^{-(t-s)/\tau_1} - k_2 \sum_{s<t} L_s\, e^{-(t-s)/\tau_2}
$$

Plateau detection then tests whether the Kalman trend's slope has been statistically indistinguishable from zero over a rolling window.
