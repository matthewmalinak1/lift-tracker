import { useRef, useState, type PointerEvent } from "react";

/**
 * 3×3 pattern lock. Dots are numbered like a phone keypad:
 *
 *   1 2 3
 *   4 5 6
 *   7 8 9
 *
 * A pattern is sent to the server as its digits in order (e.g. a "Z" is
 * "1235789"), so the server-side password check doesn't change at all.
 * As on Android, dragging straight across an unused dot (e.g. 1 → 3 passes
 * over 2) picks that dot up too.
 */

const SIZE = 300;
const GAP = 100;
const HIT_RADIUS = 34;
const MIN_DOTS = 4;

const DOTS = Array.from({ length: 9 }, (_, i) => ({
  n: i + 1,
  x: GAP / 2 + (i % 3) * GAP,
  y: GAP / 2 + Math.floor(i / 3) * GAP,
}));

type Status = "idle" | "drawing" | "checking" | "error" | "success";

export default function PatternLock({
  onComplete,
}: {
  /** Return true if the pattern was accepted. */
  onComplete: (pattern: string) => Promise<boolean>;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [path, setPath] = useState<number[]>([]);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [hint, setHint] = useState<string | null>(null);

  const toLocal = (e: PointerEvent) => {
    const rect = svgRef.current!.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * SIZE,
      y: ((e.clientY - rect.top) / rect.height) * SIZE,
    };
  };

  const addDotsNear = (p: { x: number; y: number }, current: number[]) => {
    const hit = DOTS.find(
      (d) => !current.includes(d.n) && Math.hypot(d.x - p.x, d.y - p.y) < HIT_RADIUS,
    );
    if (!hit) return current;
    const next = [...current];
    const last = next[next.length - 1];
    if (last !== undefined) {
      // Dot exactly halfway between the last dot and this one (e.g. 1→3 skips 2).
      const sum = last + hit.n;
      const sameRow = Math.ceil(last / 3) === Math.ceil(hit.n / 3);
      const sameCol = last % 3 === hit.n % 3;
      const diagonal = (last === 1 && hit.n === 9) || (last === 9 && hit.n === 1) ||
        (last === 3 && hit.n === 7) || (last === 7 && hit.n === 3);
      if (sum % 2 === 0 && (sameRow || sameCol || diagonal)) {
        const mid = sum / 2;
        if (!next.includes(mid)) next.push(mid);
      }
    }
    next.push(hit.n);
    navigator.vibrate?.(8);
    return next;
  };

  const start = (e: PointerEvent<SVGSVGElement>) => {
    if (status === "checking") return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = toLocal(e);
    setHint(null);
    setStatus("drawing");
    setCursor(p);
    setPath(addDotsNear(p, []));
  };

  const move = (e: PointerEvent<SVGSVGElement>) => {
    if (status !== "drawing") return;
    const p = toLocal(e);
    setCursor(p);
    setPath((cur) => addDotsNear(p, cur));
  };

  const end = async () => {
    if (status !== "drawing") return;
    setCursor(null);
    if (path.length < MIN_DOTS) {
      setStatus("error");
      setHint(`Connect at least ${MIN_DOTS} dots`);
      setTimeout(() => {
        setPath([]);
        setStatus("idle");
      }, 600);
      return;
    }
    setStatus("checking");
    const ok = await onComplete(path.join(""));
    if (ok) {
      setStatus("success");
      return;
    }
    setStatus("error");
    navigator.vibrate?.([40, 40, 40]);
    setTimeout(() => {
      setPath([]);
      setStatus("idle");
    }, 700);
  };

  const pos = (n: number) => DOTS[n - 1];
  const linePoints = path.map((n) => `${pos(n).x},${pos(n).y}`).join(" ");
  const last = path.length ? pos(path[path.length - 1]) : null;

  return (
    <div className={`pattern ${status}`}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className="pattern-pad"
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        role="application"
        aria-label="Draw your unlock pattern"
      >
        <defs>
          <filter id="pattern-glow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="4" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        <g filter="url(#pattern-glow)" className="pattern-lines">
          {path.length > 1 && <polyline points={linePoints} />}
          {last && cursor && <line x1={last.x} y1={last.y} x2={cursor.x} y2={cursor.y} />}
        </g>

        {DOTS.map((d) => {
          const on = path.includes(d.n);
          return (
            <g key={d.n} className={`pattern-dot ${on ? "on" : ""}`}>
              <circle cx={d.x} cy={d.y} r={22} className="ring" />
              <circle cx={d.x} cy={d.y} r={on ? 9 : 5} className="core" />
            </g>
          );
        })}
      </svg>
      <p className="pattern-hint">
        {status === "checking"
          ? "Verifying…"
          : status === "error" && !hint
            ? "Pattern not recognized"
            : (hint ?? "Draw your pattern to unlock")}
      </p>
    </div>
  );
}
