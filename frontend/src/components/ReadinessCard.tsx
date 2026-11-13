import { useEffect, useState } from "react";
import { api, type Readiness, type ReadinessEffect } from "../api";

const DOC = "https://github.com/matthewmalinak1/lift-tracker/blob/main/docs/math/readiness.md";

function perSd(e: ReadinessEffect) {
  const v =
    e.unit === "h" ? `${e.sd_raw.toFixed(1)} h` : e.unit === "%" ? `${Math.round(e.sd_raw)}%` : `${Math.round(e.sd_raw)} ${e.unit}`;
  return `per +${v}`;
}

/** One effect: posterior mean and 90% interval on a shared axis around zero. */
function EffectRow({ e, span }: { e: ReadinessEffect; span: number }) {
  const pos = (v: number) => `${50 + (Math.max(-span, Math.min(span, v)) / span) * 50}%`;
  const helps = e.p_positive >= 0.5;
  const p = Math.round((helps ? e.p_positive : 1 - e.p_positive) * 100);
  const prob = p > 99 ? ">99" : String(p);
  return (
    <div className="rd-row">
      <div className="rd-label">
        <strong>{e.label}</strong>
        <span className="muted small">{perSd(e)}</span>
      </div>
      <div className="rd-axis" aria-label={`${e.label}: ${e.mean.toFixed(1)}% (90% range ${e.lo90.toFixed(1)} to ${e.hi90.toFixed(1)})`}>
        <span className="rd-zero" />
        <span className="rd-range" style={{ left: pos(e.lo90), width: `calc(${pos(e.hi90)} - ${pos(e.lo90)})` }} />
        <span className="rd-dot" style={{ left: pos(e.mean) }} />
      </div>
      <div className="rd-num">
        <strong>
          {e.mean >= 0 ? "+" : "−"}
          {Math.abs(e.mean).toFixed(1)}%
        </strong>
        <span className="muted small">
          {prob}% {helps ? "helps" : "hurts"}
        </span>
      </div>
    </div>
  );
}

/** Bayesian readiness model: how recovery, HRV and sleep move day-to-day strength. */
export default function ReadinessCard() {
  const [r, setR] = useState<Readiness | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    api.readiness().then(setR).catch(() => setError(true));
  }, []);

  if (error) return null;
  if (!r) {
    return (
      <article className="card model-card">
        <h3>Readiness model (Bayesian)</h3>
        <p className="muted small">Fitting…</p>
      </article>
    );
  }

  const live = r.status === "live";
  const early = live && r.days < r.days_target;
  const span = Math.max(2, ...r.effects.map((e) => Math.max(Math.abs(e.lo90), Math.abs(e.hi90))));

  return (
    <article className="card model-card">
      <div className="model-head">
        <h3>Readiness model (Bayesian)</h3>
        <span className={`status-pill ${live ? "live" : "collecting"}`}>
          {live ? (early ? "Early estimate" : "Live") : "Collecting data"}
        </span>
      </div>
      <p className="model-q">
        Do recovery, HRV and sleep change how strong you are that day? Each bar is how far above (+) or below (−)
        your trend you lift when that input is one standard deviation above your normal, with a 90% range.
      </p>

      {!live ? (
        <div className="progress-meter">
          <div className="meter-track">
            <div className="meter-fill" style={{ width: `${Math.min(100, (r.days / r.days_min) * 100)}%` }} />
          </div>
          <span className="muted small">
            {r.days} / {r.days_min} lifting days with WHOOP data for a first estimate
          </span>
        </div>
      ) : (
        <>
          <div className="rd-list">
            {r.effects.map((e) => (
              <EffectRow key={e.key} e={e} span={span} />
            ))}
          </div>
          {r.today && (
            <p className="model-headline">
              Today's WHOOP suggests{" "}
              <strong>
                {r.today.expected >= 0 ? "+" : "−"}
                {Math.abs(r.today.expected).toFixed(1)}%
              </strong>{" "}
              vs your trend (90% range {r.today.lo90.toFixed(1)} to {r.today.hi90.toFixed(1)}).
            </p>
          )}
          <p className="muted small">
            {r.days} lifting days · {r.sessions} lift sessions · day-to-day noise ±{r.noise_sd?.toFixed(1)}%
            {early && ` · ranges tighten as you reach ${r.days_target} days`}
          </p>
        </>
      )}
      <a className="doc-link" href={DOC} target="_blank" rel="noreferrer">
        How it works →
      </a>
    </article>
  );
}
