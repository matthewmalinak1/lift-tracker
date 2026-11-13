import { useEffect, useState } from "react";
import { api, recoveryZone, type HealthTrends as Trends, type TrendDay } from "../api";
import TrendChart from "./TrendChart";

const ZONE = { green: "#22c55e", yellow: "#facc15", red: "#f43f5e" } as const;

type Key = keyof Omit<TrendDay, "date" | "workout">;

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

export default function HealthTrends() {
  const [range, setRange] = useState(30);
  const [data, setData] = useState<Trends | null>(null);
  const [error, setError] = useState(false);

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
          {[30, 90].map((r) => (
            <button key={r} className={range === r ? "active" : ""} onClick={() => setRange(r)}>
              {r}d
            </button>
          ))}
        </div>
      </div>

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
    </div>
  );
}
