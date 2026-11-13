import { useEffect, useState } from "react";
import { api, prettyDate, recoveryZone, type HealthTrends as Trends, type TrendDay, type WhoopStatus } from "../api";
import TrendChart from "./TrendChart";

const ZONE = { green: "#22c55e", yellow: "#facc15", red: "#f43f5e" } as const;

type Key = keyof Omit<TrendDay, "date" | "workout" | "zones_min">;

interface Metric {
  key: Key;
  title: string;
  kind: "bar" | "line";
  color: string;
  colorFor?: (v: number) => string;
  format: (v: number) => string;
  min?: number;
  max?: number;
  note?: string;
}

const hm = (h: number) => `${Math.floor(h)}:${String(Math.round((h % 1) * 60)).padStart(2, "0")}`;

const METRICS: Metric[] = [
  {
    key: "recovery_score",
    title: "Recovery",
    kind: "bar",
    color: "#22c55e",
    colorFor: (v) => ZONE[recoveryZone(v)!],
    format: (v) => `${Math.round(v)}%`,
    min: 0,
    max: 100,
  },
  { key: "strain", title: "Strain", kind: "bar", color: "#3d9cf0", format: (v) => v.toFixed(1), min: 0, max: 21 },
  { key: "sleep_hours", title: "Sleep", kind: "bar", color: "#a5b4fc", format: hm, min: 0, max: 10 },
  {
    key: "steps",
    title: "Steps",
    kind: "bar",
    color: "#7cc4ff",
    format: (v) => (v >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}k` : String(Math.round(v))),
    min: 0,
  },
  { key: "hrv_rmssd_ms", title: "HRV", kind: "line", color: "#86efac", format: (v) => `${Math.round(v)} ms`, note: "higher is better" },
  { key: "resting_hr", title: "Resting heart rate", kind: "line", color: "#fda4af", format: (v) => `${Math.round(v)}`, note: "lower is better" },
];

const ZONE_COLORS = ["#334155", "#7cc4ff", "#4ade80", "#facc15", "#fb923c", "#f43f5e"];

/** Stacked minutes in heart-rate zones 1-5 per day, plus totals for the range. */
function ZonesCard({ days }: { days: TrendDay[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const withZones = days.filter((d) => d.zones_min);
  const totals = [1, 2, 3, 4, 5].map((z) => withZones.reduce((a, d) => a + (d.zones_min![z] ?? 0), 0));
  const maxDay = Math.max(1, ...days.map((d) => (d.zones_min ? d.zones_min.slice(1).reduce((a, b) => a + b, 0) : 0)));
  const maxTotal = Math.max(1, ...totals);
  const W = 340;
  const H = 110;
  const L = 30;
  const slot = (W - L - 8) / days.length;
  const y = (m: number) => ((H - 22) * m) / maxDay;
  const h = hover !== null ? days[hover] : null;

  return (
    <div className="card trend-card">
      <div className="trend-head">
        <h3>Heart-rate zones</h3>
        <div className="trend-nums">
          <span>
            <span className="hud-label">Zone 2+ total</span>
            <strong>{Math.round(totals.slice(1).reduce((a, b) => a + b, 0))} min</strong>
          </span>
        </div>
      </div>
      {withZones.length === 0 ? (
        <p className="muted small center chart-empty">No WHOOP-tracked workouts with zone data in this range.</p>
      ) : (
        <>
          <div className="chart-wrap">
            <svg
              viewBox={`0 0 ${W} ${H}`}
              className="chart trend"
              onPointerLeave={() => setHover(null)}
              onPointerMove={(e) => {
                const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
                const px = ((e.clientX - r.left) / r.width) * W;
                setHover(Math.max(0, Math.min(days.length - 1, Math.floor((px - L) / slot))));
              }}
            >
              <line x1={L} x2={W - 8} y1={H - 18} y2={H - 18} className="grid" />
              <text x={L - 5} y={H - 15} className="axis" textAnchor="end">0</text>
              <text x={L - 5} y={H - 18 - y(maxDay) + 3} className="axis" textAnchor="end">
                {Math.round(maxDay)}
              </text>
              {days.map((d, i) => {
                if (!d.zones_min) return null;
                let base = H - 18;
                return (
                  <g key={i} opacity={hover === null || hover === i ? 1 : 0.45}>
                    {[1, 2, 3, 4, 5].map((z) => {
                      const hgt = y(d.zones_min![z] ?? 0);
                      if (hgt <= 0) return null;
                      base -= hgt;
                      return (
                        <rect key={z} x={L + slot * i + slot * 0.16} width={Math.max(2, slot * 0.68)} y={base} height={Math.max(0.5, hgt - 0.6)} fill={ZONE_COLORS[z]} />
                      );
                    })}
                  </g>
                );
              })}
              <text x={L} y={H - 2} className="axis">{prettyDate(days[0].date)}</text>
              <text x={W - 8} y={H - 2} className="axis" textAnchor="end">{prettyDate(days[days.length - 1].date)}</text>
            </svg>
            {h && h.zones_min && (
              <div className="chart-tip" style={{ left: `${((L + slot * (hover! + 0.5)) / W) * 100}%` }}>
                <strong>{prettyDate(h.date, { weekday: "short", month: "short", day: "numeric" })}</strong>
                {[1, 2, 3, 4, 5].map((z) => (
                  <span key={z}>
                    Z{z}: {Math.round(h.zones_min![z])} min
                  </span>
                ))}
              </div>
            )}
          </div>
          <div className="zone-totals">
            {[1, 2, 3, 4, 5].map((z, i) => (
              <div key={z} className="zone-row">
                <span className="zone-name">
                  <i style={{ background: ZONE_COLORS[z] }} /> Zone {z}
                </span>
                <div className="vol-track">
                  <div className="vol-bar" style={{ width: `${(totals[i] / maxTotal) * 100}%`, background: ZONE_COLORS[z] }} />
                </div>
                <span className="vol-num">{Math.round(totals[i])}m</span>
              </div>
            ))}
          </div>
        </>
      )}
      <p className="muted small trend-note">From workouts WHOOP recorded (auto-detected or started in the WHOOP app).</p>
    </div>
  );
}

export default function HealthTrends() {
  const [range, setRange] = useState(30);
  const [data, setData] = useState<Trends | null>(null);
  const [error, setError] = useState(false);
  const [whoop, setWhoop] = useState<WhoopStatus | null>(null);

  useEffect(() => {
    api.whoopStatus().then(setWhoop).catch(() => setWhoop(null));
  }, []);

  useEffect(() => {
    setData(null);
    api.healthTrends(range).then(setData).catch(() => setError(true));
  }, [range]);

  if (error) return <p className="muted center">Couldn't load WHOOP trends.</p>;

  return (
    <div className="health">
      <div className="range-row">
        <span className="muted small">WHOOP · green ticks = workout days</span>
        <div className="segmented small-seg">
          {[7, 30, 90].map((r) => (
            <button key={r} className={range === r ? "active" : ""} onClick={() => setRange(r)}>
              {r}d
            </button>
          ))}
        </div>
      </div>

      {whoop?.connected && whoop.missing_scopes.length > 0 && (
        <a className="reconnect-banner" href="/api/whoop/connect">
          Reconnect WHOOP to turn on heart-rate zones →
        </a>
      )}

      {!data && <p className="muted center">Loading…</p>}
      {data &&
        METRICS.map((m) => {
          const series = data.days.map((d) => ({ date: d.date, value: d[m.key] as number | null, workout: d.workout }));
          const latest = [...series].reverse().find((d) => d.value !== null);
          const avg = data.averages[m.key] ?? null;
          return (
            <div key={m.key} className="card trend-card">
              <div className="trend-head">
                <h3>{m.title}</h3>
                <div className="trend-nums">
                  <span>
                    <span className="hud-label">Latest</span>
                    <strong>{latest?.value != null ? m.format(latest.value) : "--"}</strong>
                  </span>
                  <span>
                    <span className="hud-label">{range}d avg</span>
                    <strong className="muted-strong">{avg != null ? m.format(avg) : "--"}</strong>
                  </span>
                </div>
              </div>
              <TrendChart
                data={series}
                kind={m.kind}
                color={m.color}
                colorFor={m.colorFor}
                format={m.format}
                avg={avg}
                min={m.min}
                max={m.max}
              />
              {m.note && <p className="muted small trend-note">{m.note} · dashed line = average</p>}
            </div>
          );
        })}
      {data && <ZonesCard days={data.days} />}
    </div>
  );
}
