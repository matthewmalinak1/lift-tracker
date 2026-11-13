import { useEffect, useState } from "react";
import { api, type Backtest } from "../api";

const REPO_DOC = "https://github.com/matthewmalinak1/lift-tracker/blob/main/docs/math/kalman-e1rm.md#6-walk-forward-backtest";

function monthsBetween(a: string, b: string) {
  const days = (new Date(b).getTime() - new Date(a).getTime()) / 86_400_000;
  const m = Math.max(1, Math.round(days / 30.4));
  return `${m} month${m === 1 ? "" : "s"}`;
}

/** Out-of-sample results for the strength filter, plus a ready-made resume line. */
export default function BacktestCard() {
  const [b, setB] = useState<Backtest | null>(null);
  const [error, setError] = useState(false);
  const [showLifts, setShowLifts] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    api.backtest().then(setB).catch(() => setError(true));
  }, []);

  if (error) return null;
  if (!b) {
    return (
      <article className="card model-card">
        <h3>Backtest</h3>
        <p className="muted small">Running walk-forward test…</p>
      </article>
    );
  }

  const ready = b.predictions >= 20 && b.coverage_95 !== null;
  const resume =
    ready && b.date_from && b.date_to
      ? `Backtested a local-linear-trend Kalman filter (MLE-fitted noise) on ${monthsBetween(b.date_from, b.date_to)} of personal ` +
        `strength data (${b.predictions} out-of-sample predictions across ${b.lifts} lifts): 95% prediction ` +
        `bands covered ${Math.round(b.coverage_95! * 100)}% of sessions, and one-step error was ` +
        `${Math.round(b.improvement_pct ?? 0)}% lower than a naive last-session forecast.`
      : null;

  const copy = async () => {
    if (!resume) return;
    try {
      await navigator.clipboard.writeText(resume);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    <article className="card model-card backtest">
      <div className="model-head">
        <h3>Backtest · trend filter</h3>
        <span className={`status-pill ${ready ? "live" : "collecting"}`}>{ready ? "Live" : "Collecting data"}</span>
      </div>
      <p className="model-q">
        Each session is predicted using only the sessions before it, so nothing from the future leaks in. The trend
        filter is compared with the original no-trend filter and with "same as last session".
      </p>

      {b.predictions === 0 ? (
        <p className="muted small">Needs at least 4 sessions of a lift. Import your history or keep logging.</p>
      ) : (
        <>
          <div className="bt-grid">
            <div className="bt-tile">
              <span className="hud-label">Band coverage</span>
              <strong>{Math.round((b.coverage_95 ?? 0) * 100)}%</strong>
              <span className="muted small">target 95%</span>
            </div>
            <div className="bt-tile">
              <span className="hud-label">Band width</span>
              <strong>±{b.band_pct?.toFixed(1)}%</strong>
              <span className="muted small">of the lift</span>
            </div>
            <div className="bt-tile">
              <span className="hud-label">Filter error</span>
              <strong>{b.mae_pct?.toFixed(1)}%</strong>
              <span className="muted small">
                naive {b.naive_mae_pct?.toFixed(1)}% · no-trend {b.level_only_mae_pct?.toFixed(1)}%
              </span>
            </div>
            <div className="bt-tile">
              <span className="hud-label">vs naive</span>
              <strong className={(b.improvement_pct ?? 0) > 0 ? "good" : "bad"}>
                {(b.improvement_pct ?? 0) > 0 ? "−" : "+"}
                {Math.abs(b.improvement_pct ?? 0).toFixed(0)}%
              </strong>
              <span className="muted small">error</span>
            </div>
          </div>
          <p className="muted small">
            {b.predictions} predictions · {b.lifts} lifts · {b.sessions} workouts
            {!ready && " · results firm up after ~20 predictions"}
          </p>

          {resume && (
            <div className="resume-line">
              <span className="hud-label">Resume line (from your data)</span>
              <p>{resume}</p>
              <button className="chip" onClick={copy}>
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
          )}

          <button className="text-btn" onClick={() => setShowLifts(!showLifts)}>
            {showLifts ? "Hide" : "Show"} per-lift results
          </button>
          {showLifts && (
            <div className="bt-table">
              <div className="bt-row head">
                <span>Lift</span>
                <span>n</span>
                <span>Cover</span>
                <span>Err</span>
                <span>No-trend</span>
                <span>Naive</span>
              </div>
              {b.per_lift.map((l) => (
                <div key={l.exercise_id} className="bt-row">
                  <span>{l.name}</span>
                  <span>{l.predictions}</span>
                  <span>{Math.round(l.coverage_95 * 100)}%</span>
                  <span>{l.mae_pct.toFixed(1)}%</span>
                  <span>{l.level_only_mae_pct.toFixed(1)}%</span>
                  <span>{l.naive_mae_pct.toFixed(1)}%</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
      <a className="doc-link" href={REPO_DOC} target="_blank" rel="noreferrer">
        How it works →
      </a>
    </article>
  );
}
