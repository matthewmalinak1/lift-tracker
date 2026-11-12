import { useEffect, useRef, useState, type PointerEvent } from "react";
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

function Figure({ shapes, status, selected, label }: {
  shapes: MuscleShape[];
  status: BodyStatus | null;
  selected: Muscle | null;
  label: string;
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
        data-muscle={shape.muscle}
      />
    );
  };

  return (
    <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} className="hologram" role="img" aria-label={label}>
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

/**
 * Drag left/right to spin the hologram. The front and back figures are the two
 * faces of a card turned with CSS 3D transforms (rotateY plus
 * backface-visibility), so the back appears as the body turns past 90°. On
 * release it keeps spinning with the flick's momentum, then eases to whichever
 * face it's closest to. A touch that barely moves counts as a tap and selects
 * the muscle under the finger.
 */
function Turntable({ status, selected, onSelect }: {
  status: BodyStatus | null;
  selected: Muscle | null;
  onSelect: (m: Muscle | null) => void;
}) {
  const [angle, setAngle] = useState(0);
  const [hinted, setHinted] = useState(false);
  const angleRef = useRef(0);
  const drag = useRef<{ x: number; startX: number; moved: boolean; v: number; t: number } | null>(null);
  const raf = useRef<number | null>(null);

  const set = (a: number) => {
    angleRef.current = a;
    setAngle(a);
  };
  const stopAnim = () => {
    if (raf.current !== null) cancelAnimationFrame(raf.current);
    raf.current = null;
  };

  const DEG_PER_PX = 0.6;

  const down = (e: PointerEvent<HTMLDivElement>) => {
    stopAnim();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, startX: e.clientX, moved: false, v: 0, t: performance.now() };
  };

  const move = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    const now = performance.now();
    if (Math.abs(e.clientX - d.startX) > 6) {
      d.moved = true;
      setHinted(true);
    }
    if (d.moved) {
      set(angleRef.current + dx * DEG_PER_PX);
      // velocity in degrees per ms, smoothed
      d.v = 0.8 * ((dx * DEG_PER_PX) / Math.max(1, now - d.t)) + 0.2 * d.v;
    }
    d.x = e.clientX;
    d.t = now;
  };

  const up = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;

    if (!d.moved) {
      // Tap: find the muscle under the finger (pointer capture hides it from
      // normal click events).
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const m = el?.getAttribute("data-muscle") as Muscle | null;
      onSelect(m && m !== selected ? m : null);
      return;
    }

    // Coast with momentum, then settle on the nearest face (0° or 180°).
    let v = d.v;
    let last = performance.now();
    const step = (now: number) => {
      const dt = now - last;
      last = now;
      v *= Math.pow(0.994, dt);
      if (Math.abs(v) > 0.02) {
        set(angleRef.current + v * dt);
        raf.current = requestAnimationFrame(step);
        return;
      }
      const target = Math.round(angleRef.current / 180) * 180;
      const diff = target - angleRef.current;
      if (Math.abs(diff) < 0.3) {
        set(target);
        raf.current = null;
        return;
      }
      set(angleRef.current + diff * Math.min(1, dt / 90));
      raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
  };

  useEffect(() => stopAnim, []);

  return (
    <div
      className="turntable"
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
    >
      <div className="turntable-card" style={{ transform: `rotateY(${angle}deg)` }}>
        <div className="face front">
          <Figure shapes={FRONT} status={status} selected={selected} label="Body recovery map, front" />
        </div>
        <div className="face back">
          <Figure shapes={BACK} status={status} selected={selected} label="Body recovery map, back" />
        </div>
      </div>
      <span className={`turn-hint ${hinted ? "gone" : ""}`}>⟲ drag to rotate</span>
    </div>
  );
}

export default function Body() {
  const [status, setStatus] = useState<BodyStatus | null>(null);
  const [error, setError] = useState(false);
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
          <Turntable status={status} selected={selected} onSelect={setSelected} />
        </div>

        <div className="hud-col">
          {RIGHT.map((s) => (
            <StatPanel key={s.key} label={s.label} statKey={s.key} whoop={whoop} side="right" />
          ))}
        </div>
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
