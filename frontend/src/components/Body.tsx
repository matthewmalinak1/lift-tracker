import { useEffect, useState } from "react";
import { api, type BodyStatus, type Muscle, type WhoopToday } from "../api";
import { BACK, FRONT, HEAD, OUTLINE_HALF, VIEW_H, VIEW_W, type MuscleShape } from "./bodyShapes";

const MUSCLE_LABELS: Record<Muscle, string> = {
  chest: "Chest",
  shoulders: "Shoulders",
  biceps: "Biceps",
  triceps: "Triceps",
  forearms: "Forearms",
  abs: "Abs",
  obliques: "Obliques",
  traps: "Traps",
  lats: "Lats",
  lower_back: "Lower back",
  glutes: "Glutes",
  quads: "Quads",
  hamstrings: "Hamstrings",
  calves: "Calves",
};

// Recovered muscles sit at the theme's light blue; fresh ones glow red.
const BLUE = [124, 196, 255];
const RED = [255, 77, 94];

function heatColor(f: number): string {
  const c = BLUE.map((b, i) => Math.round(b + (RED[i] - b) * f));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

function ago(days: number | null): string {
  if (days === null) return "";
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}

type StatKey = "recovery" | "hrv" | "rhr" | "sleep" | "strain" | "steps";

function stat(w: WhoopToday | null, key: StatKey): { value: string; unit: string } {
  const n = (v: number | null | undefined, digits = 0) =>
    v === null || v === undefined ? "--" : v.toFixed(digits);
  switch (key) {
    case "recovery":
      return { value: n(w?.recovery_score), unit: "%" };
    case "hrv":
      return { value: n(w?.hrv_rmssd_ms), unit: "ms" };
    case "rhr":
      return { value: n(w?.resting_hr), unit: "bpm" };
    case "sleep": {
      const h = w?.sleep_hours;
      if (h === null || h === undefined) return { value: "--", unit: "" };
      return { value: `${Math.floor(h)}:${String(Math.round((h % 1) * 60)).padStart(2, "0")}`, unit: "h" };
    }
    case "strain":
      return { value: n(w?.strain, 1), unit: "" };
    case "steps":
      return {
        value: w?.steps === null || w?.steps === undefined ? "--" : w.steps.toLocaleString(),
        unit: "",
      };
  }
}

const LEFT: { key: StatKey; label: string }[] = [
  { key: "recovery", label: "Recovery" },
  { key: "hrv", label: "HRV" },
  { key: "rhr", label: "Resting HR" },
];
const RIGHT: { key: StatKey; label: string }[] = [
  { key: "sleep", label: "Sleep" },
  { key: "strain", label: "Strain" },
  { key: "steps", label: "Steps" },
];

function StatPanel({ label, statKey, whoop, side }: {
  label: string;
  statKey: StatKey;
  whoop: WhoopToday | null;
  side: "left" | "right";
}) {
  const { value, unit } = stat(whoop, statKey);
  return (
    <div className={`hud-stat ${side}`}>
      <span className="hud-label">{label}</span>
      <span className="hud-value">
        {value}
        {value !== "--" && <small>{unit}</small>}
      </span>
    </div>
  );
}

function Figure({ shapes, status, selected, onSelect }: {
  shapes: MuscleShape[];
  status: BodyStatus | null;
  selected: Muscle | null;
  onSelect: (m: Muscle) => void;
}) {
  const mirror = `translate(${VIEW_W}, 0) scale(-1, 1)`;
  const renderMuscle = (shape: MuscleShape, i: number, mirrored: boolean) => {
    const f = status?.muscles[shape.muscle]?.fatigue ?? 0;
    const color = heatColor(f);
    const isSel = selected === shape.muscle;
    return (
      <path
        key={`${mirrored ? "r" : "l"}-${i}`}
        d={shape.d}
        transform={mirrored ? mirror : undefined}
        fill={color}
        fillOpacity={0.1 + 0.6 * f + (isSel ? 0.15 : 0)}
        stroke={color}
        strokeOpacity={isSel ? 1 : 0.55 + 0.45 * f}
        strokeWidth={isSel ? 1.6 : 0.9}
        filter={f > 0.05 ? "url(#glow-strong)" : undefined}
        className="muscle"
        onClick={() => onSelect(shape.muscle)}
      />
    );
  };

  return (
    <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} className="hologram" role="img" aria-label="Body recovery map">
      <defs>
        <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="2" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <filter id="glow-strong" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="3.5" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        {/* Keeps the scan band inside the body silhouette */}
        <clipPath id="body-clip">
          <ellipse {...HEAD} />
          <path d={OUTLINE_HALF} />
          <path d={OUTLINE_HALF} transform={mirror} />
        </clipPath>
        <linearGradient id="scan" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#7cc4ff" stopOpacity="0" />
          <stop offset="0.5" stopColor="#7cc4ff" stopOpacity="0.35" />
          <stop offset="1" stopColor="#7cc4ff" stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* Base ring under the feet */}
      <ellipse cx={100} cy={444} rx={46} ry={7} className="holo-ring" />
      <ellipse cx={100} cy={444} rx={30} ry={4} className="holo-ring faint" />

      {/* Silhouette */}
      <g filter="url(#glow)" className="holo-outline">
        <ellipse {...HEAD} />
        <path d={OUTLINE_HALF} />
        <path d={OUTLINE_HALF} transform={mirror} />
        {/* centre line */}
        <line x1={100} y1={64} x2={100} y2={256} className="holo-axis" />
      </g>

      {shapes.map((s, i) => renderMuscle(s, i, false))}
      {shapes.map((s, i) => renderMuscle(s, i, true))}

      {/* Moving scan band, clipped to the body */}
      <g clipPath="url(#body-clip)">
        <rect x={0} y={0} width={VIEW_W} height={30} fill="url(#scan)" className="scan-band" />
      </g>
    </svg>
  );
}

export default function Body() {
  const [status, setStatus] = useState<BodyStatus | null>(null);
  const [error, setError] = useState(false);
  const [view, setView] = useState<"front" | "back">("front");
  const [selected, setSelected] = useState<Muscle | null>(null);

  useEffect(() => {
    api
      .body()
      .then(setStatus)
      .catch(() => setError(true));
  }, []);

  const whoop = status?.whoop ?? null;
  const recovering = status
    ? (Object.entries(status.muscles) as [Muscle, BodyStatus["muscles"][Muscle]][])
        .filter(([, s]) => s.fatigue > 0)
        .sort((a, b) => b[1].fatigue - a[1].fatigue)
    : [];
  const sel = selected && status ? status.muscles[selected] : null;

  return (
    <section className="body-screen">
      <div className="hud">
        <div className="hud-col">
          {LEFT.map((s) => (
            <StatPanel key={s.key} label={s.label} statKey={s.key} whoop={whoop} side="left" />
          ))}
        </div>

        <div className="hud-figure">
          <Figure
            shapes={view === "front" ? FRONT : BACK}
            status={status}
            selected={selected}
            onSelect={(m) => setSelected(m === selected ? null : m)}
          />
        </div>

        <div className="hud-col">
          {RIGHT.map((s) => (
            <StatPanel key={s.key} label={s.label} statKey={s.key} whoop={whoop} side="right" />
          ))}
        </div>
      </div>

      <div className="segmented">
        {(["front", "back"] as const).map((v) => (
          <button key={v} className={view === v ? "active" : ""} onClick={() => setView(v)}>
            {v === "front" ? "Front" : "Back"}
          </button>
        ))}
      </div>

      <div className="heat-legend">
        <span>Trained today</span>
        <div className="heat-bar" />
        <span>Recovered ({status?.recovery_days ?? 3}d)</span>
      </div>

      {sel && selected && (
        <p className="muscle-readout">
          <strong>{MUSCLE_LABELS[selected]}</strong>{" "}
          {sel.last_trained
            ? `· trained ${ago(sel.days_since)} · ${Math.round((1 - sel.fatigue) * 100)}% recovered`
            : "· not trained recently · fully recovered"}
        </p>
      )}

      {recovering.length > 0 && (
        <div className="card recovering">
          <h3>Recovering</h3>
          {recovering.map(([m, s]) => (
            <div key={m} className="recovering-row">
              <span className="dot" style={{ background: heatColor(s.fatigue) }} />
              <span>{MUSCLE_LABELS[m]}</span>
              <span className="muted">{ago(s.days_since)}</span>
              <span className="pct">{Math.round((1 - s.fatigue) * 100)}%</span>
            </div>
          ))}
        </div>
      )}

      {!whoop && (
        <p className="muted small center">WHOOP stats appear once WHOOP is connected (Phase 2).</p>
      )}
      {error && <p className="muted small center">Couldn't load recovery data.</p>}
    </section>
  );
}
