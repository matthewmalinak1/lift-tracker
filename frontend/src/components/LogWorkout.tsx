import { useCallback, useEffect, useState } from "react";
import {
  ALL_MUSCLES,
  api,
  localDateISO,
  MUSCLE_LABELS,
  prettyDate,
  SPLIT_LABELS,
  type LogTemplate,
  type Muscle,
  type SplitDay,
  type TemplateExercise,
} from "../api";

const SPLITS: SplitDay[] = ["chest_bi", "back_shoulder_tri", "legs"];
const SETS_PER_EXERCISE = 2;

interface SetDraft {
  weight: string;
  reps: string;
  rir: string; // "" = not recorded
}
type Draft = Record<number, SetDraft[]>; // exercise id -> sets

const emptySets = (): SetDraft[] =>
  Array.from({ length: SETS_PER_EXERCISE }, () => ({ weight: "", reps: "", rir: "" }));

// The draft survives closing the app mid-workout. Storage can be unavailable
// (private mode, some in-app browsers), so every access is guarded.
const DRAFT_KEY = "lift-draft-v1";
function loadDraft(): { date: string; split: SplitDay; sets: Draft } | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
function saveDraft(d: { date: string; split: SplitDay; sets: Draft } | null) {
  try {
    if (d) localStorage.setItem(DRAFT_KEY, JSON.stringify(d));
    else localStorage.removeItem(DRAFT_KEY);
  } catch {
    /* ignore */
  }
}

const isComplete = (s: SetDraft) => Number(s.weight) >= 0 && s.weight !== "" && Number(s.reps) > 0;

function lastLine(ex: TemplateExercise): string | null {
  if (!ex.last_date || ex.last_sets.length === 0) return null;
  const sets = ex.last_sets.map((s) => `${s.weight > 0 ? s.weight : "BW"}×${s.reps}`).join(", ");
  return `Last ${prettyDate(ex.last_date)}: ${sets}`;
}

function AddExercise({ split, onAdded }: { split: SplitDay; onAdded: (ex: TemplateExercise) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [muscles, setMuscles] = useState<Muscle[]>([]);
  const [error, setError] = useState<string | null>(null);

  const toggle = (m: Muscle) =>
    setMuscles((cur) => (cur.includes(m) ? cur.filter((x) => x !== m) : [...cur, m]));

  const save = async () => {
    setError(null);
    try {
      const ex = await api.createExercise({ name: name.trim(), split_day: split, muscles });
      onAdded({ id: ex.id, name: ex.name, muscles: ex.muscles, last_date: null, last_sets: [] });
      setName("");
      setMuscles([]);
      setOpen(false);
    } catch (e) {
      setError(String(e).includes("409") ? "You already have an exercise with that name." : "Couldn't save.");
    }
  };

  if (!open) {
    return (
      <button className="add-ex-btn" onClick={() => setOpen(true)}>
        + Add exercise
      </button>
    );
  }
  return (
    <div className="card add-ex">
      <input
        className="text-input"
        placeholder="Exercise name (e.g. Incline DB Press)"
        value={name}
        onChange={(e) => setName(e.target.value)}
        autoFocus
      />
      <p className="muted small">Muscles it works (lights up the body map):</p>
      <div className="chips">
        {ALL_MUSCLES.map((m) => (
          <button
            key={m}
            className={`chip ${muscles.includes(m) ? "on" : ""}`}
            onClick={() => toggle(m)}
          >
            {MUSCLE_LABELS[m]}
          </button>
        ))}
      </div>
      {error && <p className="error small">{error}</p>}
      <div className="row-end">
        <button className="text-btn" onClick={() => setOpen(false)}>
          Cancel
        </button>
        <button className="primary small-btn" disabled={!name.trim()} onClick={save}>
          Save exercise
        </button>
      </div>
    </div>
  );
}

export default function LogWorkout({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const saved = loadDraft();
  const [date, setDate] = useState(saved?.date ?? localDateISO());
  const [split, setSplit] = useState<SplitDay | null>(saved?.split ?? null);
  const [template, setTemplate] = useState<LogTemplate | null>(null);
  const [sets, setSets] = useState<Draft>(saved?.sets ?? {});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback((s?: SplitDay) => {
    setTemplate(null);
    api
      .template(s)
      .then((t) => {
        setTemplate(t);
        setSplit(t.split_day);
      })
      .catch(() => setError("Couldn't load your exercises. Is the database connected?"));
  }, []);

  useEffect(() => {
    load(split ?? undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (split) saveDraft({ date, split, sets });
  }, [date, split, sets]);

  const chooseSplit = (s: SplitDay) => {
    if (s === split) return;
    setSets({});
    load(s);
  };

  const update = (exId: number, i: number, field: keyof SetDraft, value: string) =>
    setSets((cur) => {
      const list = (cur[exId] ?? emptySets()).map((x) => ({ ...x }));
      list[i][field] = value;
      return { ...cur, [exId]: list };
    });

  const copyLast = (ex: TemplateExercise) =>
    setSets((cur) => ({
      ...cur,
      [ex.id]: emptySets().map((_, i) => {
        const l = ex.last_sets[i];
        return l ? { weight: String(l.weight), reps: String(l.reps), rir: l.rir === null ? "" : String(l.rir) } : { weight: "", reps: "", rir: "" };
      }),
    }));

  const completed = Object.entries(sets).flatMap(([exId, list]) =>
    list
      .map((s, i) => ({ s, i }))
      .filter(({ s }) => isComplete(s))
      .map(({ s, i }) => ({
        exercise_id: Number(exId),
        set_number: i + 1,
        weight: Number(s.weight),
        reps: Number(s.reps),
        rir: s.rir === "" ? null : Number(s.rir),
      })),
  );

  const finish = async () => {
    if (!split || completed.length === 0) return;
    setSaving(true);
    setError(null);
    try {
      await api.createWorkout({ date, split_day: split, sets: completed });
      saveDraft(null);
      onSaved();
    } catch {
      setError("Couldn't save. Your sets are kept, so try again in a moment.");
      setSaving(false);
    }
  };

  const discard = () => {
    saveDraft(null);
    onClose();
  };

  return (
    <div className="log">
      <header className="log-head">
        <button className="text-btn" onClick={onClose}>
          Close
        </button>
        <h2>Log workout</h2>
        <span />
      </header>

      <label className="date-row">
        <span className="muted small">Date</span>
        <input
          type="date"
          className="date-input"
          value={date}
          max={localDateISO()}
          onChange={(e) => setDate(e.target.value)}
        />
      </label>

      <div className="split-picker">
        {SPLITS.map((s) => (
          <button key={s} className={`split-btn ${s === split ? "on" : ""}`} onClick={() => chooseSplit(s)}>
            {SPLIT_LABELS[s]}
            {template?.suggested_split === s && <span className="suggested">most recovered</span>}
          </button>
        ))}
      </div>

      <p className="muted small rir-hint">
        Weight in lb (0 for bodyweight). RIR = reps you had left in the tank; 0 means failure. Optional, but it
        makes the strength estimate more accurate.
      </p>

      {!template && !error && <p className="muted center">Loading…</p>}

      {template?.exercises.length === 0 && (
        <p className="muted center small">
          No exercises for {split ? SPLIT_LABELS[split] : "this day"} yet. Add the ones you do below; they'll be
          remembered for next time.
        </p>
      )}

      {template?.exercises.map((ex) => {
        const list = sets[ex.id] ?? emptySets();
        const last = lastLine(ex);
        return (
          <div key={ex.id} className="card log-ex">
            <div className="log-ex-head">
              <div>
                <div className="log-ex-name">{ex.name}</div>
                {last && <div className="muted small">{last}</div>}
              </div>
              {ex.last_sets.length > 0 && (
                <button className="chip" onClick={() => copyLast(ex)}>
                  Same as last
                </button>
              )}
            </div>
            {list.map((s, i) => {
              const l = ex.last_sets[i];
              return (
                <div key={i} className="set-row">
                  <span className="muted small set-label">Set {i + 1}</span>
                  <input
                    inputMode="decimal"
                    className="num-input"
                    placeholder={l ? String(l.weight) : "lb"}
                    value={s.weight}
                    onChange={(e) => update(ex.id, i, "weight", e.target.value)}
                    aria-label={`${ex.name} set ${i + 1} weight`}
                  />
                  <span className="muted">×</span>
                  <input
                    inputMode="numeric"
                    className="num-input"
                    placeholder={l ? String(l.reps) : "reps"}
                    value={s.reps}
                    onChange={(e) => update(ex.id, i, "reps", e.target.value)}
                    aria-label={`${ex.name} set ${i + 1} reps`}
                  />
                  <select
                    className="rir-select"
                    value={s.rir}
                    onChange={(e) => update(ex.id, i, "rir", e.target.value)}
                    aria-label={`${ex.name} set ${i + 1} reps in reserve`}
                  >
                    <option value="">RIR</option>
                    <option value="0">0</option>
                    <option value="1">1</option>
                    <option value="2">2</option>
                    <option value="3">3+</option>
                  </select>
                </div>
              );
            })}
          </div>
        );
      })}

      {split && template && (
        <AddExercise
          split={split}
          onAdded={(ex) => setTemplate((t) => (t ? { ...t, exercises: [...t.exercises, ex] } : t))}
        />
      )}

      {error && <p className="error center small">{error}</p>}

      <div className="log-footer">
        <button className="text-btn" onClick={discard}>
          Discard
        </button>
        <button className="primary" disabled={saving || completed.length === 0} onClick={finish}>
          {saving ? "Saving…" : `Finish · ${completed.length} set${completed.length === 1 ? "" : "s"}`}
        </button>
      </div>
    </div>
  );
}
