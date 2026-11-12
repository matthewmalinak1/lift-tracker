# Muscle recovery heat map

**Question:** which muscles are still recovering, and how much?
**Where:** [`backend/app/recovery.py`](../../backend/app/recovery.py); served by `GET /api/body`; drawn on the home screen.

## v1: linear decay, volume-scaled

For muscle $m$ and each session $s$ that trained it (within the last $D$ days):

$$
\text{load}_s = \min\!\left(1,\ \frac{\text{sets}_s}{N}\right),
\qquad
\text{decay}_s = \max\!\left(0,\ 1 - \frac{\Delta d_s}{D}\right),
\qquad
F_m = \max_s\ \text{load}_s \cdot \text{decay}_s
$$

| Symbol | Meaning | Value |
|---|---|---|
| $\text{sets}_s$ | sets that hit $m$ in session $s$ (summed across exercises) | from the log |
| $N$ | sets counted as a full hit | 4 (2 exercises × 2 sets) |
| $\Delta d_s$ | whole days since session $s$ | 0, 1, 2, … |
| $D$ | days to full recovery | 3 |
| $F_m$ | fatigue: 0 = recovered, 1 = just trained hard | colour ramp blue → red |

Each exercise is tagged with the muscles it trains. Untagged exercises, and sessions logged without set detail, fall back to the split day's main muscles.

**Why max and not sum?** Two light sessions shouldn't add up to more than one hard one in a model this simple. Summing only makes sense once each session's contribution decays properly, which is v2.

**Displayed as** "% recovered" $= 100\,(1 - F_m)$.

## v2 (planned): exponential fatigue, fit from data

Replace the linear ramp with the fatigue half of the Banister model, per muscle group:

$$
F_m(t) = \sum_{s \le t} \text{load}_s \, e^{-(t - t_s)/\tau_m}
$$

where $\tau_m$ (how quickly each muscle recovers) is estimated from my own data: how much e1RM on that muscle's lifts is depressed as a function of time since it was last trained. This links the heat map to the fitness-fatigue model in Phase 5.

## Limitations (worth saying in an interview)

- 3 days is a rule of thumb; real recovery depends on volume, proximity to failure, sleep and the muscle itself.
- Tags are binary: a muscle is either worked by an exercise or not, with no "secondary muscle at 50%" weighting yet.
- Whole-day resolution: a 7 am and a 9 pm session on the same day are treated the same.
