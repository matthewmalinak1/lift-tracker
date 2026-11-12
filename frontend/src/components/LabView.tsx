import { useEffect, useState } from "react";
import { api, type Lab } from "../api";
import { TrendBadge } from "./Progress";

const REPO = "https://github.com/matthewmalinak1/lift-tracker/blob/main/";

const STATUS_LABEL = { live: "Live", collecting: "Collecting data", planned: "Planned" };

export default function LabView() {
  const [lab, setLab] = useState<Lab | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    api.lab().then(setLab).catch(() => setError(true));
  }, []);

  if (error) return <p className="muted center">Couldn't load the lab. Is the database connected?</p>;
  if (!lab) return <p className="muted center">Loading…</p>;

  return (
    <section className="lab">
      <p className="lab-intro muted">
        The models behind the app: what each one answers, what it has found, and how much data it still needs.
      </p>

      {lab.models.map((m) => (
        <article key={m.key} className="card model-card">
          <div className="model-head">
            <h3>{m.name}</h3>
            <span className={`status-pill ${m.status}`}>{STATUS_LABEL[m.status]}</span>
          </div>
          <p className="model-q">{m.question}</p>
          {m.headline && <p className="model-headline">{m.headline}</p>}
          {m.progress !== null && m.status !== "live" && (
            <div className="progress-meter" aria-label={m.progress_label ?? ""}>
              <div className="meter-track">
                <div className="meter-fill" style={{ width: `${Math.round(m.progress * 100)}%` }} />
              </div>
              <span className="muted small">{m.progress_label}</span>
            </div>
          )}
          <a className="doc-link" href={REPO + m.doc} target="_blank" rel="noreferrer">
            How it works →
          </a>
        </article>
      ))}

      {lab.plateaus.length > 0 && (
        <div className="card">
          <h3 className="section-title">Plateau check · last 6 weeks</h3>
          {lab.plateaus.map((p) => (
            <div key={p.exercise_id} className="plateau-row">
              <span>{p.name}</span>
              <TrendBadge t={p.trend} />
            </div>
          ))}
          <p className="muted small">
            Plateau = confident the weekly trend is within ±1% of zero. Unclear = the 95% interval is too wide to
            call it either way yet.
          </p>
        </div>
      )}
    </section>
  );
}
