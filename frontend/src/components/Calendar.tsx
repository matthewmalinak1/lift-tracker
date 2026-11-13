import { useEffect, useMemo, useRef, useState } from "react";
import {
  api,
  localDateISO,
  prettyDate,
  SPLIT_LABELS,
  type CalendarMonth,
  type DayDetail,
  type SplitDay,
  type Summary,
} from "../api";
import Sheet from "./Sheet";

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];

function toKey(y: number, m: number, d: number) {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function DayPanel({ date, onChanged }: { date: string; onChanged: () => void }) {
  const [detail, setDetail] = useState<DayDetail | null>(null);
  const [confirming, setConfirming] = useState<number | null>(null);

  useEffect(() => {
    setDetail(null);
    api.day(date).then(setDetail).catch(() => setDetail({ date, workouts: [], whoop: null }));
  }, [date]);

  const remove = async (id: number) => {
    await api.deleteWorkout(id);
    setConfirming(null);
    onChanged();
  };

  const w = detail?.whoop;
  return (
    <div className="day-panel">
      <h2>{prettyDate(date, { weekday: "long", month: "long", day: "numeric" })}</h2>

      {w && (
        <div className="day-whoop">
          <div>
            <span className="hud-label">Recovery</span>
            <strong>{w.recovery_score ?? "--"}%</strong>
          </div>
          <div>
            <span className="hud-label">HRV</span>
            <strong>{w.hrv_rmssd_ms?.toFixed(0) ?? "--"} ms</strong>
          </div>
          <div>
            <span className="hud-label">Sleep</span>
            <strong>{w.sleep_hours ? `${w.sleep_hours.toFixed(1)} h` : "--"}</strong>
          </div>
        </div>
      )}

      {!detail && <p className="muted">Loading…</p>}
      {detail && detail.workouts.length === 0 && <p className="muted">Rest day.</p>}

      {detail?.workouts.map((wo) => (
        <div key={wo.id} className="day-workout">
          <div className="day-workout-head">
            <span className="pill">{SPLIT_LABELS[wo.split_day]}</span>
            <span className="muted small">
              {wo.total_sets} sets
              {wo.pr_count > 0 && (
                <span className="pr-chip">
                  {wo.pr_count} PR{wo.pr_count > 1 ? "s" : ""}
                </span>
              )}
            </span>
          </div>

          {wo.exercises.length === 0 && <p className="muted small">No set details logged.</p>}
          {wo.exercises.map((ex) => (
            <div key={ex.exercise_id} className="day-ex">
              <div className="day-ex-name">{ex.name}</div>
              {ex.sets.map((s) => (
                <div key={s.set_number} className="day-set">
                  <span className="muted">Set {s.set_number}</span>
                  <span>
                    <strong>{s.weight > 0 ? s.weight : "BW"}</strong> × {s.reps}
                    {s.rir !== null && <span className="muted"> · RIR {s.rir}</span>}
                  </span>
                  <span className="muted small">{s.weight > 0 ? `e1RM ${Math.round(s.e1rm)}` : ""}</span>
                  {s.is_pr ? <span className="pr-chip">PR</span> : <span />}
                </div>
              ))}
            </div>
          ))}

          {confirming === wo.id ? (
            <div className="confirm-row">
              <span className="small">Delete this workout?</span>
              <button className="text-btn" onClick={() => setConfirming(null)}>
                Cancel
              </button>
              <button className="danger-btn" onClick={() => remove(wo.id)}>
                Delete
              </button>
            </div>
          ) : (
            <button className="text-btn delete-link" onClick={() => setConfirming(wo.id)}>
              Delete workout
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

const SPLIT_SHORT: Record<SplitDay, string> = {
  chest_bi: "C/B",
  back_shoulder_tri: "B/S/T",
  legs: "LEGS",
};

/** 1-4: how bright a trained day glows, from its set count vs the month's busiest day. */
function level(sets: number, max: number) {
  if (max <= 0 || sets <= 0) return 2;
  return Math.max(1, Math.min(4, Math.ceil((sets / max) * 4)));
}

/** Hologram-style month: trained days glow green by volume, with split and PR marks. */
export default function Calendar({ onChanged }: { onChanged: () => void }) {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1); // 1-12
  const [data, setData] = useState<CalendarMonth | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [reload, setReload] = useState(0);
  const swipe = useRef<number | null>(null);

  useEffect(() => {
    setError(false);
    api.calendar(year, month).then(setData).catch(() => setError(true));
  }, [year, month, reload]);

  useEffect(() => {
    api.summary().then(setSummary).catch(() => setSummary(null));
  }, [reload]);

  const byDate = useMemo(() => new Map((data?.days ?? []).map((d) => [d.date, d])), [data]);
  const monthSets = data?.days.reduce((a, d) => a + d.sets, 0) ?? 0;
  const splitCounts = (data?.days ?? []).reduce<Record<string, number>>((acc, d) => {
    acc[d.split_day] = (acc[d.split_day] ?? 0) + 1;
    return acc;
  }, {});

  const firstWeekday = new Date(year, month - 1, 1).getDay();
  const daysInMonth = new Date(year, month, 0).getDate();
  const todayKey = localDateISO();

  const shift = (delta: number) => {
    const d = new Date(year, month - 1 + delta, 1);
    setYear(d.getFullYear());
    setMonth(d.getMonth() + 1);
  };

  const monthName = new Date(year, month - 1, 1).toLocaleString(undefined, { month: "long" });

  return (
    <section className="cal2">
      <div className="cal2-head">
        <button className="ghost-btn" onClick={() => shift(-1)} aria-label="Previous month">
          ‹
        </button>
        <div className="cal2-title">
          <h2>{monthName}</h2>
          <span>{year}</span>
        </div>
        <button className="ghost-btn" onClick={() => shift(1)} aria-label="Next month">
          ›
        </button>
      </div>

      <div className="cal2-stats">
        <div className="hud-stat">
          <span className="hud-label">This week</span>
          <span className="hud-value">{summary?.this_week ?? "--"}</span>
        </div>
        <div className="hud-stat">
          <span className="hud-label">Workouts</span>
          <span className="hud-value">{data?.days.length ?? "--"}</span>
        </div>
        <div className="hud-stat">
          <span className="hud-label">Sets</span>
          <span className="hud-value">{data ? monthSets : "--"}</span>
        </div>
        <div className="hud-stat">
          <span className="hud-label">PRs</span>
          <span className="hud-value gold">{data?.prs ?? "--"}</span>
        </div>
      </div>

      <div
        className="cal2-grid"
        onPointerDown={(e) => (swipe.current = e.clientX)}
        onPointerUp={(e) => {
          if (swipe.current === null) return;
          const dx = e.clientX - swipe.current;
          swipe.current = null;
          if (Math.abs(dx) > 60) shift(dx < 0 ? 1 : -1);
        }}
      >
        {WEEKDAYS.map((d, i) => (
          <div key={i} className="cal2-weekday">
            {d}
          </div>
        ))}
        {Array.from({ length: firstWeekday }, (_, i) => (
          <div key={`pad-${i}`} />
        ))}
        {Array.from({ length: daysInMonth }, (_, i) => {
          const key = toKey(year, month, i + 1);
          const day = byDate.get(key);
          const cls = [
            "cal2-day",
            day ? `trained lv${level(day.sets, data?.max_sets ?? 0)}` : "",
            key === todayKey ? "today" : "",
            key > todayKey ? "future" : "",
          ].join(" ");
          return (
            <button key={key} className={cls} onClick={() => setSelected(key)}>
              <span className="num">{i + 1}</span>
              {day && <span className="split">{SPLIT_SHORT[day.split_day]}</span>}
              {day && day.prs > 0 && <span className="pr-star" title={`${day.prs} PR`}>★</span>}
            </button>
          );
        })}
      </div>

      <div className="cal2-legend">
        <span className="ramp">
          <span className="muted">Fewer sets</span>
          <i className="lv1" />
          <i className="lv2" />
          <i className="lv3" />
          <i className="lv4" />
          <span className="muted">More</span>
        </span>
        <span>
          <span className="gold">★</span> PR
        </span>
      </div>

      {data && data.days.length > 0 && (
        <div className="cal2-splits">
          {(Object.keys(SPLIT_LABELS) as SplitDay[]).map((s) => (
            <div key={s} className="split-chip">
              <span className="split-tag">{SPLIT_SHORT[s]}</span>
              <span>{SPLIT_LABELS[s]}</span>
              <strong>×{splitCounts[s] ?? 0}</strong>
            </div>
          ))}
        </div>
      )}

      {error && <p className="muted small center">Couldn't load this month.</p>}

      <Sheet open={selected !== null} onClose={() => setSelected(null)}>
        {selected && (
          <DayPanel
            date={selected}
            onChanged={() => {
              setSelected(null);
              setReload((r) => r + 1);
              onChanged();
            }}
          />
        )}
      </Sheet>
    </section>
  );
}
