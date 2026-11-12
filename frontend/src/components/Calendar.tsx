import { useEffect, useMemo, useState } from "react";
import {
  api,
  localDateISO,
  prettyDate,
  SPLIT_LABELS,
  type DayDetail,
  type Summary,
  type Workout,
} from "../api";
import ImportHistory from "./ImportHistory";
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

/** Month grid with trained days in green; tap a day for its details. */
export default function Calendar({ onChanged }: { onChanged: () => void }) {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1); // 1-12
  const [workouts, setWorkouts] = useState<Workout[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    setError(null);
    api.workouts(year, month).then(setWorkouts).catch((e) => setError(String(e)));
  }, [year, month, reload]);

  useEffect(() => {
    api.summary().then(setSummary).catch(() => setSummary(null));
  }, [reload]);

  const trained = useMemo(() => new Set(workouts.map((w) => w.date)), [workouts]);
  const monthCount = trained.size;

  const firstWeekday = new Date(year, month - 1, 1).getDay();
  const daysInMonth = new Date(year, month, 0).getDate();
  const todayKey = localDateISO();

  const shift = (delta: number) => {
    const d = new Date(year, month - 1 + delta, 1);
    setYear(d.getFullYear());
    setMonth(d.getMonth() + 1);
  };

  const monthName = new Date(year, month - 1, 1).toLocaleString(undefined, {
    month: "long",
    year: "numeric",
  });

  return (
    <section>
      <div className="summary-row">
        <div className="summary-tile">
          <span className="hud-label">This week</span>
          <strong>{summary?.this_week ?? "--"}</strong>
        </div>
        <div className="summary-tile">
          <span className="hud-label">{new Date(year, month - 1).toLocaleString(undefined, { month: "short" })}</span>
          <strong>{monthCount}</strong>
        </div>
        <div className="summary-tile">
          <span className="hud-label">All time</span>
          <strong>{summary?.total ?? "--"}</strong>
        </div>
      </div>

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
          const key = toKey(year, month, i + 1);
          const cls = [
            "cal-day",
            trained.has(key) ? "trained" : "",
            key === todayKey ? "today" : "",
            key > todayKey ? "future" : "",
          ].join(" ");
          return (
            <button key={key} className={cls} onClick={() => setSelected(key)}>
              {i + 1}
            </button>
          );
        })}
      </div>

      <div className="cal-legend">
        <span className="swatch trained" /> Workout logged
        <span className="swatch today" /> Today
      </div>

      {error && <p className="muted small">Couldn't load workouts.</p>}

      <button className="add-ex-btn import-btn" onClick={() => setImporting(true)}>
        ⇪ Import past workouts from Excel
      </button>

      <Sheet open={importing} onClose={() => setImporting(false)}>
        <ImportHistory
          onDone={() => {
            setImporting(false);
            setReload((r) => r + 1);
            onChanged();
          }}
        />
      </Sheet>

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
