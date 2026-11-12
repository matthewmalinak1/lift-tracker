import { useEffect, useMemo, useState } from "react";
import { api, SPLIT_LABELS, type Workout } from "../api";

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];

function toKey(y: number, m: number, d: number) {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Month grid that highlights workout days; tap a day to see that session. */
export default function Calendar() {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1); // 1-12
  const [workouts, setWorkouts] = useState<Workout[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
    api.workouts(year, month).then(setWorkouts).catch((e) => setError(String(e)));
  }, [year, month]);

  const byDate = useMemo(
    () => new Map(workouts.map((w) => [w.date, w])),
    [workouts],
  );

  const firstWeekday = new Date(year, month - 1, 1).getDay();
  const daysInMonth = new Date(year, month, 0).getDate();
  const todayKey = toKey(today.getFullYear(), today.getMonth() + 1, today.getDate());

  const shift = (delta: number) => {
    const d = new Date(year, month - 1 + delta, 1);
    setYear(d.getFullYear());
    setMonth(d.getMonth() + 1);
    setSelected(null);
  };

  const monthName = new Date(year, month - 1, 1).toLocaleString(undefined, {
    month: "long",
    year: "numeric",
  });
  const selectedWorkout = selected ? byDate.get(selected) : undefined;

  return (
    <section>
      <div className="cal-header">
        <button className="icon-btn" onClick={() => shift(-1)} aria-label="Previous month">
          ‹
        </button>
        <h2>{monthName}</h2>
        <button className="icon-btn" onClick={() => shift(1)} aria-label="Next month">
          ›
        </button>
      </div>

      <div className="cal-grid">
        {WEEKDAYS.map((d, i) => (
          <div key={i} className="cal-weekday">
            {d}
          </div>
        ))}
        {Array.from({ length: firstWeekday }, (_, i) => (
          <div key={`pad-${i}`} />
        ))}
        {Array.from({ length: daysInMonth }, (_, i) => {
          const day = i + 1;
          const key = toKey(year, month, day);
          const w = byDate.get(key);
          const cls = [
            "cal-day",
            w ? `trained split-${w.split_day}` : "",
            key === todayKey ? "today" : "",
            key === selected ? "selected" : "",
          ].join(" ");
          return (
            <button key={key} className={cls} onClick={() => setSelected(key)}>
              {day}
            </button>
          );
        })}
      </div>

      {error && <p className="muted">Couldn't load workouts ({error}).</p>}

      {selected && (
        <div className="card">
          <h3>
            {new Date(selected + "T00:00").toLocaleDateString(undefined, {
              weekday: "long",
              month: "short",
              day: "numeric",
            })}
          </h3>
          {selectedWorkout ? (
            <>
              <p className="accent">{SPLIT_LABELS[selectedWorkout.split_day]}</p>
              <p className="muted">
                {selectedWorkout.sets.length} {selectedWorkout.sets.length === 1 ? "set" : "sets"}{" "}
                logged. The per-exercise breakdown arrives in Phase 1.
              </p>
            </>
          ) : (
            <p className="muted">Rest day.</p>
          )}
        </div>
      )}
    </section>
  );
}
