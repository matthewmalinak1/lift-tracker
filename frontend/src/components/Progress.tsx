import { useEffect, useState } from "react";
import {
  api,
  localDateISO,
  MUSCLE_LABELS,
  prettyDate,
  type LiftProgress,
  type LiftSummary,
  type Muscle,
  type TrendOut,
  type VolumeWeek,
} from "../api";
import StrengthChart from "./StrengthChart";

export function TrendBadge({ t }: { t: TrendOut }) {
  if (t.status === "not_enough_data") {
    return <span className="status-pill neutral">Need {4 - t.sessions > 0 ? 4 - t.sessions : 0} more sessions</span>;
  }
  const label = {
    improving: "↗ Improving",
    plateau: "→ Plateau",
    declining: "↘ Declining",
    unclear: "? Unclear",
  }[t.status];
  const pct = t.pct_per_week ?? 0;
  return (
    <span className={`status-pill ${t.status}`}>
      {label} {pct >= 0 ? "+" : ""}
      {pct.toFixed(1)}%/wk
    </span>
  );
}

function Volume({ weeks }: { weeks: VolumeWeek[] }) {
  if (weeks.length === 0) return null;
  const current = weeks[weeks.length - 1].sets;
  const muscles = (Object.keys(MUSCLE_LABELS) as Muscle[])
    .map((m) => ({
      m,
      now: current[m] ?? 0,
      avg: weeks.reduce((a, w) => a + (w.sets[m] ?? 0), 0) / weeks.length,
    }))
    .filter((r) => r.now > 0 || r.avg > 0)
    .sort((a, b) => b.now - a.now || b.avg - a.avg);
  const max = Math.max(1, ...muscles.map((r) => Math.max(r.now, r.avg)));

  return (
    <div className="card">
      <h3 className="section-title">Sets per muscle · this week</h3>
      {muscles.length === 0 && <p className="muted small">No sets logged in the last {weeks.length} weeks.</p>}
      {muscles.map((r) => (
        <div key={r.m} className="vol-row" title={`${r.now} sets this week · ${r.avg.toFixed(1)} avg`}>
          <span className="vol-name">{MUSCLE_LABELS[r.m]}</span>
          <div className="vol-track">
            <div className="vol-bar" style={{ width: `${(r.now / max) * 100}%` }} />
            <div className="vol-avg" style={{ left: `${(r.avg / max) * 100}%` }} />
          </div>
          <span className="vol-num">{r.now}</span>
        </div>
      ))}
      <p className="muted small legend-note">
        <i className="lg-avg" /> {weeks.length}-week average
      </p>
    </div>
  );
}

export default function Progress() {
  const [lifts, setLifts] = useState<LiftSummary[] | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [detail, setDetail] = useState<LiftProgress | null>(null);
  const [volume, setVolume] = useState<VolumeWeek[]>([]);
  const [error, setError] = useState(false);

  useEffect(() => {
    api
      .lifts()
      .then((l) => {
        setLifts(l);
        if (l.length) setSelected(l[0].exercise_id);
      })
      .catch(() => setError(true));
    api.volume(4).then(setVolume).catch(() => {});
  }, []);

  useEffect(() => {
    if (selected === null) return;
    setDetail(null);
    api.lift(selected).then(setDetail).catch(() => setError(true));
  }, [selected]);

  if (error) return <p className="muted center">Couldn't load progress. Is the database connected?</p>;
  if (lifts === null) return <p className="muted center">Loading…</p>;
  if (lifts.length === 0) {
    return (
      <section className="card empty">
        <h2>No lifts yet</h2>
        <p className="muted">Log a workout with the + button and your strength curves show up here.</p>
      </section>
    );
  }

  return (
    <section className="progress">
      <div className="lift-picker">
        {lifts.map((l) => (
          <button
            key={l.exercise_id}
            className={`chip ${l.exercise_id === selected ? "on" : ""}`}
            onClick={() => setSelected(l.exercise_id)}
          >
            {l.name}
          </button>
        ))}
      </div>

      {detail && detail.series.length > 0 && (
        <>
          <div className="hero">
            <span className="hud-label">Estimated 1RM today</span>
            <div className="hero-num">
              {Math.round(detail.today_estimate!)}
              <small> {detail.unit}</small>
            </div>
            <span className="muted small">
              95% range {Math.round(detail.today_lower!)}–{Math.round(detail.today_upper!)}
            </span>
            <TrendBadge t={detail.trend} />
          </div>

          <div className="card chart-card">
            <StrengthChart
              series={detail.series}
              unit={detail.unit}
              today={{
                date: localDateISO(),
                estimate: detail.today_estimate!,
                lower: detail.today_lower!,
                upper: detail.today_upper!,
              }}
            />
          </div>

          <div className="stat-grid">
            <div className="card stat">
              <span className="hud-label">Best e1RM</span>
              <strong>{Math.round(detail.best_e1rm!)}</strong>
              <span className="muted small">{prettyDate(detail.best_e1rm_date!)}</span>
            </div>
            <div className="card stat">
              <span className="hud-label">Heaviest set</span>
              <strong>{detail.heaviest_weight}</strong>
              <span className="muted small">{prettyDate(detail.heaviest_weight_date!)}</span>
            </div>
            <div className="card stat">
              <span className="hud-label">Day-to-day noise</span>
              <strong>±{detail.noise_pct?.toFixed(1)}%</strong>
              <span className="muted small">{detail.fitted ? "fitted to you" : "default until 6 sessions"}</span>
            </div>
          </div>
        </>
      )}
      {!detail && <p className="muted center">Loading…</p>}

      <Volume weeks={volume} />
    </section>
  );
}
