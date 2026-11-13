import { useRef, useState, type PointerEvent } from "react";
import { prettyDate } from "../api";

const W = 340;
const H = 120;
const PAD = { l: 34, r: 8, t: 8, b: 18 };

export interface TrendValue {
  date: string;
  value: number | null;
  workout?: boolean;
}

/**
 * One metric over time: bars or a line, a dashed average, ticks under the
 * axis on workout days, and a tap/hover readout.
 */
export default function TrendChart({
  data,
  kind,
  color,
  colorFor,
  format,
  avg,
  min,
  max,
}: {
  data: TrendValue[];
  kind: "bar" | "line";
  color: string;
  colorFor?: (v: number) => string;
  format: (v: number) => string;
  avg?: number | null;
  min?: number;
  max?: number;
}) {
  const ref = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);

  const vals = data.map((d) => d.value).filter((v): v is number => v !== null);
  if (vals.length === 0) return <p className="muted small center chart-empty">No data in this range yet.</p>;

  let lo = min ?? Math.min(...vals);
  // A fixed top (e.g. 10 h of sleep) still stretches if a day goes past it.
  let hi = max !== undefined ? Math.max(max, ...vals) : Math.max(...vals);
  if (min === undefined) lo -= (hi - lo) * 0.15 || 1;
  if (max === undefined) hi += (hi - lo) * 0.1 || 1;
  if (kind === "bar" && min === undefined) lo = Math.min(0, lo);

  const n = data.length;
  const slot = (W - PAD.l - PAD.r) / n;
  const x = (i: number) => PAD.l + slot * (i + 0.5);
  const y = (v: number) => H - PAD.b - ((v - lo) / (hi - lo)) * (H - PAD.t - PAD.b);
  const ticks = [lo, (lo + hi) / 2, hi];

  // Line with gaps where data is missing
  let path = "";
  data.forEach((d, i) => {
    if (d.value === null) return;
    const prev = i > 0 ? data[i - 1].value : null;
    path += `${prev === null ? "M" : "L"}${x(i)},${y(d.value)} `;
  });

  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    const rect = ref.current!.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const i = Math.max(0, Math.min(n - 1, Math.floor((px - PAD.l) / slot)));
    setHover(i);
  };
  const h = hover !== null ? data[hover] : null;

  return (
    <div className="chart-wrap">
      <svg
        ref={ref}
        viewBox={`0 0 ${W} ${H}`}
        className="chart trend"
        onPointerMove={onMove}
        onPointerDown={onMove}
        onPointerLeave={() => setHover(null)}
      >
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} className="grid" />
            <text x={PAD.l - 5} y={y(t) + 3} className="axis" textAnchor="end">
              {format(t)}
            </text>
          </g>
        ))}

        {kind === "bar" &&
          data.map((d, i) =>
            d.value === null ? null : (
              <rect
                key={i}
                x={x(i) - Math.max(1, slot * 0.34)}
                width={Math.max(2, slot * 0.68)}
                y={y(d.value)}
                height={Math.max(1, y(lo) - y(d.value))}
                rx={Math.min(3, slot * 0.3)}
                fill={colorFor ? colorFor(d.value) : color}
                opacity={hover === null || hover === i ? 0.9 : 0.45}
              />
            ),
          )}

        {kind === "line" && (
          <>
            <path d={path} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            {data.map((d, i) =>
              d.value === null || n > 45 ? null : (
                <circle key={i} cx={x(i)} cy={y(d.value)} r={2.6} fill={color} />
              ),
            )}
          </>
        )}

        {avg !== null && avg !== undefined && (
          <line x1={PAD.l} x2={W - PAD.r} y1={y(avg)} y2={y(avg)} className="avg-line" />
        )}

        {data.map((d, i) =>
          d.workout ? <rect key={`w${i}`} x={x(i) - 1.5} y={H - PAD.b + 4} width={3} height={4} rx={1} className="workout-tick" /> : null,
        )}

        <text x={PAD.l} y={H - 2} className="axis">
          {prettyDate(data[0].date)}
        </text>
        <text x={W - PAD.r} y={H - 2} className="axis" textAnchor="end">
          {prettyDate(data[n - 1].date)}
        </text>

        {h && <line x1={x(hover!)} x2={x(hover!)} y1={PAD.t} y2={H - PAD.b} className="hover-line" />}
      </svg>
      {h && (
        <div className="chart-tip" style={{ left: `${(x(hover!) / W) * 100}%` }}>
          <strong>{prettyDate(h.date, { weekday: "short", month: "short", day: "numeric" })}</strong>
          <span>{h.value === null ? "no data" : format(h.value)}</span>
          {h.workout && <span className="muted">workout day</span>}
        </div>
      )}
    </div>
  );
}
