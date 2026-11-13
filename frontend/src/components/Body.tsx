import { useEffect, useRef, useState, type PointerEvent } from "react";
import {
  api,
  MUSCLE_LABELS,
  recoveryZone,
  SPLIT_LABELS,
  type BodyStatus,
  type Muscle,
  type WhoopStatus,
  type WhoopToday,
} from "../api";

function daysSince(iso: string) {
  const d = new Date(iso + "T00:00");
  const t = new Date();
  t.setHours(0, 0, 0, 0);
  return Math.round((t.getTime() - d.getTime()) / 86_400_000);
}
import { BACK, FRONT, HEAD, OUTLINE_HALF, VIEW_H, VIEW_W, type MuscleShape } from "./bodyShapes";
import Body3D, { canUse3D } from "./body3d/Body3D";


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

const ZONE_COLOR = { green: "#22c55e", yellow: "#facc15", red: "#f43f5e" } as const;

/** WHOOP-style dial: an arc filled to value/max with the reading in the middle. */
function Ring({
  label,
  fraction,
  color,
  value,
  unit,
  sub,
}: {
  label: string;
  fraction: number | null;
  color: string;
  value: string;
  unit?: string;
  sub?: string;
}) {
  const R = 40;
  const C = 2 * Math.PI * R;
  const f = fraction === null ? 0 : Math.max(0, Math.min(1, fraction));
  return (
    <div className="ring">
      <svg viewBox="0 0 100 100" role="img" aria-label={`${label} ${value}${unit ?? ""}`}>
        <circle cx="50" cy="50" r={R} className="ring-track" />
        <circle
          cx="50"
          cy="50"
          r={R}
          className="ring-fill"
          stroke={color}
          strokeDasharray={`${C * f} ${C}`}
          transform="rotate(-90 50 50)"
          style={{ filter: `drop-shadow(0 0 4px ${color})` }}
        />
        <text x="50" y="50" className="ring-value" textAnchor="middle" dominantBaseline="central">
          {value}
          {unit && value !== "--" && <tspan className="ring-unit">{unit}</tspan>}
        </text>
      </svg>
      <span className="ring-label">{label}</span>
      {sub && <span className="ring-sub">{sub}</span>}
    </div>
  );
}

function hm(hours: number | null | undefined) {
  if (hours === null || hours === undefined) return "--";
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  return `${h}:${String(m === 60 ? 0 : m).padStart(2, "0")}`;
}

/** "+12%" style change vs the 30-day average, coloured by whether it's good. */
function Delta({ now, avg, higherIsBetter, pct }: { now: number | null; avg: number | null; higherIsBetter: boolean; pct?: boolean }) {
  if (now === null || avg === null || avg === 0) return null;
  const diff = pct ? (100 * (now - avg)) / avg : now - avg;
  if (Math.abs(diff) < (pct ? 1 : 0.5)) return <span className="delta flat">≈ avg</span>;
  const good = diff > 0 === higherIsBetter;
  return (
    <span className={`delta ${good ? "good" : "bad"}`}>
      {diff > 0 ? "↑" : "↓"} {Math.abs(diff).toFixed(0)}
      {pct ? "%" : ""} vs avg
    </span>
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

const AUTO_SYNC_MINUTES = 30;

function minutesAgo(iso: string) {
  return Math.round((Date.now() - new Date(iso).getTime()) / 60000);
}

function syncedLabel(iso: string | null) {
  if (!iso) return "never";
  const m = minutesAgo(iso);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h} h ago` : `${Math.round(h / 24)} d ago`;
}

/** Connect button, or sync status once connected. Syncs on its own when the
 * last sync is more than half an hour old. */
function WhoopBar({ onSynced }: { onSynced: () => void }) {
  const [st, setSt] = useState<WhoopStatus | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sync = async () => {
    setSyncing(true);
    setError(null);
    try {
      await api.whoopSync();
      setSt(await api.whoopStatus());
      onSynced();
    } catch (e) {
      setError(String(e).includes("connect again") ? "WHOOP needs reconnecting." : "WHOOP sync failed.");
    } finally {
      setSyncing(false);
    }
  };

  useEffect(() => {
    api
      .whoopStatus()
      .then((s) => {
        setSt(s);
        if (s.connected && (!s.last_sync_at || minutesAgo(s.last_sync_at) > AUTO_SYNC_MINUTES)) sync();
      })
      .catch(() => setSt(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!st) return null;
  if (!st.configured) {
    return (
      <p className="muted small center">
        WHOOP isn't set up yet: add WHOOP_CLIENT_ID and WHOOP_CLIENT_SECRET in Vercel.
      </p>
    );
  }
  if (!st.connected || error === "WHOOP needs reconnecting." || st.missing_scopes?.length) {
    return (
      <a className="whoop-connect" href="/api/whoop/connect">
        <span className="whoop-dot" />{" "}
        {error || st.missing_scopes?.length ? "Reconnect WHOOP" : "Connect WHOOP"}
        {st.missing_scopes?.length ? <small className="muted"> · adds HR zones</small> : null}
      </a>
    );
  }
  return (
    <div className="whoop-bar">
      <span className="whoop-dot on" />
      <span className="muted small">
        WHOOP · {syncing ? "syncing…" : `synced ${syncedLabel(st.last_sync_at)}`}
        {st.days_stored > 0 && ` · ${st.days_stored} day${st.days_stored === 1 ? "" : "s"}`}
      </span>
      <button className="text-btn" onClick={sync} disabled={syncing}>
        Sync
      </button>
      {error && <span className="error small">{error}</span>}
    </div>
  );
}

export default function Body({ onLogWeight }: { onLogWeight: () => void }) {
  const [status, setStatus] = useState<BodyStatus | null>(null);
  const [error, setError] = useState(false);
  const [selected, setSelected] = useState<Muscle | null>(null);
  const [reload, setReload] = useState(0);
  const [weighedToday, setWeighedToday] = useState<boolean | null>(null);

  useEffect(() => {
    api
      .body()
      .then(setStatus)
      .catch(() => setError(true));
    api
      .weight(7)
      .then((w) => setWeighedToday(w.today_logged))
      .catch(() => setWeighedToday(null));
  }, [reload]);

  const whoop: WhoopToday | null = status?.whoop ?? null;
  const base = status?.baseline ?? null;
  const zone = recoveryZone(whoop?.recovery_score);
  const recovering = status
    ? (Object.entries(status.muscles) as [Muscle, BodyStatus["muscles"][Muscle]][])
        .filter(([, s]) => s.fatigue > 0)
        .sort((a, b) => b[1].fatigue - a[1].fatigue)
    : [];
  const sel = selected && status ? status.muscles[selected] : null;
  const sleepFrac =
    whoop?.sleep_performance != null
      ? whoop.sleep_performance / 100
      : whoop?.sleep_hours != null
        ? whoop.sleep_hours / 8
        : null;

  return (
    <section className="body-screen">
      <div className="rings">
        <Ring
          label="Recovery"
          fraction={whoop?.recovery_score != null ? whoop.recovery_score / 100 : null}
          color={zone ? ZONE_COLOR[zone] : "#3a4a66"}
          value={whoop?.recovery_score != null ? String(Math.round(whoop.recovery_score)) : "--"}
          unit="%"
        />
        <Ring
          label="Strain"
          fraction={whoop?.strain != null ? whoop.strain / 21 : null}
          color="#3d9cf0"
          value={whoop?.strain != null ? whoop.strain.toFixed(1) : "--"}
          sub="of 21"
        />
        <Ring
          label="Sleep"
          fraction={sleepFrac}
          color="#a5b4fc"
          value={hm(whoop?.sleep_hours)}
          sub={whoop?.sleep_performance != null ? `${Math.round(whoop.sleep_performance)}% perf.` : undefined}
        />
      </div>

      <div className="figure-stage">
        {canUse3D ? (
          <Body3D status={status} selected={selected} onSelect={setSelected} />
        ) : (
          <Turntable status={status} selected={selected} onSelect={setSelected} />
        )}

        <div className="corner-chip left">
          <span className="hud-label">Steps</span>
          <strong>{whoop?.steps != null ? whoop.steps.toLocaleString() : "--"}</strong>
        </div>
        <div className="corner-chip right">
          <div>
            <span className="hud-label">Resting HR</span>
            <strong>
              {whoop?.resting_hr != null ? Math.round(whoop.resting_hr) : "--"}
              <small> bpm</small>
            </strong>
            <Delta now={whoop?.resting_hr ?? null} avg={base?.resting_hr ?? null} higherIsBetter={false} />
          </div>
          <div>
            <span className="hud-label">HRV</span>
            <strong>
              {whoop?.hrv_rmssd_ms != null ? Math.round(whoop.hrv_rmssd_ms) : "--"}
              <small> ms</small>
            </strong>
            <Delta now={whoop?.hrv_rmssd_ms ?? null} avg={base?.hrv_rmssd_ms ?? null} higherIsBetter pct />
          </div>
        </div>
      </div>

      {sel && selected ? (
        <p className="muscle-readout">
          <strong>{MUSCLE_LABELS[selected]}</strong>{" "}
          {sel.last_trained
            ? `· trained ${ago(sel.days_since)} · ${Math.round((1 - sel.fatigue) * 100)}% recovered`
            : "· not trained recently · fully recovered"}
        </p>
      ) : (
        <div className="heat-legend">
          <span>Trained today</span>
          <div className="heat-bar" />
          <span>Recovered ({status?.recovery_days ?? 3}d)</span>
        </div>
      )}

      {status && (
        <div className={`card today-card ${status.plan.recovery_zone ?? ""}`}>
          <div className="today-head">
            <span className="hud-label">Today</span>
            {status.plan.recovery_zone && <span className={`rec-dot ${status.plan.recovery_zone}`} />}
          </div>
          <div className="today-split">{SPLIT_LABELS[status.plan.suggested_split]}</div>
          <p className="muted small">
            {status.plan.message}
            {status.plan.last_trained && ` Last done ${ago(daysSince(status.plan.last_trained))}.`}
          </p>
          {weighedToday === false && (
            <button className="weigh-nudge" onClick={onLogWeight}>
              ⚖ Log this morning's weight →
            </button>
          )}
        </div>
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

      <WhoopBar onSynced={() => setReload((r) => r + 1)} />
      {error && <p className="muted small center">Couldn't load recovery data.</p>}
    </section>
  );
}
