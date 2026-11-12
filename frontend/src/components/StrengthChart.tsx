import { useMemo, useRef, useState, type PointerEvent } from "react";
import { prettyDate, type SeriesPoint } from "../api";

const W = 340;
const H = 210;
const PAD = { l: 38, r: 10, t: 12, b: 24 };

const dayNum = (iso: string) => new Date(iso + "T00:00").getTime() / 86_400_000;

function niceStep(range: number) {
  const raw = range / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
}

/**
 * Kalman-filtered e1RM: the line is the estimate, the shaded band its 95%
 * interval, the dots each session's best set. Hover/drag for exact values.
 */
export default function StrengthChart({
  series,
  unit,
  today,
}: {
  series: SeriesPoint[];
  unit: string;
  today?: { date: string; estimate: number; lower: number; upper: number } | null;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);

  const geo = useMemo(() => {
    const pts = [...series];
    const ext = today && today.date > series[series.length - 1].date ? today : null;
    const xs = pts.map((p) => dayNum(p.date)).concat(ext ? [dayNum(ext.date)] : []);
    const lows = pts.map((p) => Math.min(p.lower, p.observed)).concat(ext ? [ext.lower] : []);
    const highs = pts.map((p) => Math.max(p.upper, p.observed)).concat(ext ? [ext.upper] : []);
    let x0 = Math.min(...xs);
    let x1 = Math.max(...xs);
    if (x1 - x0 < 7) {
      x0 -= 3;
      x1 += 3;
    }
    const step = niceStep(Math.max(10, Math.max(...highs) - Math.min(...lows)));
    const y0 = Math.floor(Math.min(...lows) / step) * step;
    const y1 = Math.ceil(Math.max(...highs) / step) * step;
    const sx = (d: number) => PAD.l + ((d - x0) / (x1 - x0)) * (W - PAD.l - PAD.r);
    const sy = (v: number) => H - PAD.b - ((v - y0) / (y1 - y0)) * (H - PAD.t - PAD.b);
    const ticks: number[] = [];
    for (let v = y0; v <= y1 + 1e-9; v += step) ticks.push(v);
    return { pts, ext, sx, sy, ticks, x0, x1 };
  }, [series, today]);

  const { pts, ext, sx, sy, ticks } = geo;
  const X = (p: { date: string }) => sx(dayNum(p.date));

  const band =
    pts.map((p, i) => `${i ? "L" : "M"}${X(p)},${sy(p.upper)}`).join(" ") +
    " " +
    [...pts].reverse().map((p) => `L${X(p)},${sy(p.lower)}`).join(" ") +
    " Z";
  const line = pts.map((p, i) => `${i ? "L" : "M"}${X(p)},${sy(p.estimate)}`).join(" ");
  const last = pts[pts.length - 1];

  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    const rect = svgRef.current!.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * W;
    let best = 0;
    pts.forEach((p, i) => {
      if (Math.abs(X(p) - x) < Math.abs(X(pts[best]) - x)) best = i;
    });
    setHover(best);
  };

  const h = hover !== null ? pts[hover] : null;
  const firstLabel = prettyDate(pts[0].date);
  const lastLabel = prettyDate((ext ?? last).date);

  return (
    <div className="chart-wrap">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="chart"
        onPointerMove={onMove}
        onPointerDown={onMove}
        onPointerLeave={() => setHover(null)}
        role="img"
        aria-label="Estimated one-rep max over time with 95% confidence band"
      >
        {/* recessive grid + y labels */}
        {ticks.map((v) => (
          <g key={v}>
            <line x1={PAD.l} x2={W - PAD.r} y1={sy(v)} y2={sy(v)} className="grid" />
            <text x={PAD.l - 6} y={sy(v) + 3} className="axis" textAnchor="end">
              {v}
            </text>
          </g>
        ))}
        <text x={PAD.l} y={H - 6} className="axis">
          {firstLabel}
        </text>
        <text x={W - PAD.r} y={H - 6} className="axis" textAnchor="end">
          {lastLabel}
        </text>

        <path d={band} className="band" />
        {ext && (
          <path
            d={`M${X(last)},${sy(last.upper)} L${sx(dayNum(ext.date))},${sy(ext.upper)} L${sx(dayNum(ext.date))},${sy(ext.lower)} L${X(last)},${sy(last.lower)} Z`}
            className="band ext"
          />
        )}
        <path d={line} className="est-line" />
        {ext && (
          <line
            x1={X(last)}
            y1={sy(last.estimate)}
            x2={sx(dayNum(ext.date))}
            y2={sy(ext.estimate)}
            className="est-line dashed"
          />
        )}
        {pts.map((p, i) => (
          <circle key={i} cx={X(p)} cy={sy(p.observed)} r={hover === i ? 5 : 4} className="obs-dot" />
        ))}

        {h && (
          <g className="crosshair">
            <line x1={X(h)} x2={X(h)} y1={PAD.t} y2={H - PAD.b} />
            <circle cx={X(h)} cy={sy(h.estimate)} r={4.5} className="est-dot" />
          </g>
        )}
      </svg>

      {h && (
        <div className="chart-tip" style={{ left: `${(X(h) / W) * 100}%` }}>
          <strong>{prettyDate(h.date)}</strong>
          <span>Session best {Math.round(h.observed)} {unit}</span>
          <span>
            Estimate {Math.round(h.estimate)} ({Math.round(h.lower)}–{Math.round(h.upper)})
          </span>
        </div>
      )}

      <div className="chart-legend">
        <span>
          <i className="lg-line" /> Estimate
        </span>
        <span>
          <i className="lg-band" /> 95% band
        </span>
        <span>
          <i className="lg-dot" /> Session best
        </span>
      </div>
    </div>
  );
}
