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

// Display order for muscle groups (top to bottom of the body, push then pull).
const GROUP_ORDER: Muscle[] = [
  "chest", "shoulders", "triceps", "biceps", "forearms", "lats", "traps",
  "lower_back", "abs", "obliques", "quads", "hamstrings", "glutes", "calves",
];

const TREND_ICON: Record<LiftSummary["trend"], { icon: string; cls: string }> = {
  improving: { icon: "↗", cls: "improving" },
  plateau: { icon: "→", cls: "plateau" },
  declining: { icon: "↘", cls: "declining" },
  unclear: { icon: "·", cls: "unclear" },
  not_enough_data: { icon: "·", cls: "unclear" },
};

function LiftDetail({ id }: { id: number }) {
  const [detail, setDetail] = useState<LiftProgress | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    setDetail(null);
    api.lift(id).then(setDetail).catch(() => setError(true));
  }, [id]);

  if (error) return <p className="muted small">Couldn't load this lift.</p>;
  if (!detail) return <p className="muted small center">Loading…</p>;
  if (detail.series.length === 0) return <p className="muted small">No weighted sets yet.</p>;

  return (
    <div className="lift-detail">
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
    </div>
  );
}

export default function Progress() {
  const [lifts, setLifts] = useState<LiftSummary[] | null>(null);
  const [openGroup, setOpenGroup] = useState<Muscle | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [volume, setVolume] = useState<VolumeWeek[]>([]);
  const [error, setError] = useState(false);

  useEffect(() => {
    api.lifts().then(setLifts).catch(() => setError(true));
    api.volume(4).then(setVolume).catch(() => {});
  }, []);

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

  const groups = GROUP_ORDER.map((m) => ({
    muscle: m,
    lifts: lifts.filter((l) => l.primary_muscle === m),
  })).filter((g) => g.lifts.length > 0);

  const toggleGroup = (m: Muscle) => {
    setOpenGroup(openGroup === m ? null : m);
    setSelected(null);
  };

  return (
    <section className="progress">
      <p className="muted small lab-intro">Tap a muscle group, then an exercise, to see its strength curve.</p>

      <div className="groups">
        {groups.map((g) => {
          const open = openGroup === g.muscle;
          const up = g.lifts.filter((l) => l.trend === "improving").length;
          return (
            <div key={g.muscle} className={`group ${open ? "open" : ""}`}>
              <button className="group-head" onClick={() => toggleGroup(g.muscle)} aria-expanded={open}>
                <span className="group-name">{MUSCLE_LABELS[g.muscle]}</span>
                <span className="muted small">
                  {g.lifts.length} exercise{g.lifts.length === 1 ? "" : "s"}
                  {up > 0 && <span className="up-count"> · {up} ↗</span>}
                </span>
                <span className="chev">{open ? "▾" : "▸"}</span>
              </button>

              {open && (
                <div className="group-body">
                  {g.lifts.map((l) => {
                    const t = TREND_ICON[l.trend];
                    const isSel = selected === l.exercise_id;
                    return (
                      <div key={l.exercise_id}>
                        <button
                          className={`lift-row ${isSel ? "on" : ""}`}
                          onClick={() => setSelected(isSel ? null : l.exercise_id)}
                        >
                          <span className="lift-name">{l.name}</span>
                          <span className="lift-est">
                            {l.current_estimate !== null ? Math.round(l.current_estimate) : "--"}
                            <small> e1RM</small>
                          </span>
                          <span className={`trend-dot ${t.cls}`}>{t.icon}</span>
                        </button>
                        {isSel && <LiftDetail id={l.exercise_id} />}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <Volume weeks={volume} />
    </section>
  );
}
