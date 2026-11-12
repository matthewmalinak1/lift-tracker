// Thin typed wrapper around the FastAPI backend. Types mirror backend/app/schemas.py.

export type SplitDay = "chest_bi" | "back_shoulder_tri" | "legs";

export const SPLIT_LABELS: Record<SplitDay, string> = {
  chest_bi: "Chest / Bi",
  back_shoulder_tri: "Back / Shoulder / Tri",
  legs: "Legs",
};

export interface SetOut {
  id: number;
  exercise_id: number;
  set_number: number;
  weight: number;
  reps: number;
  rir: number | null;
}

export interface Workout {
  id: number;
  date: string; // YYYY-MM-DD
  split_day: SplitDay;
  notes: string | null;
  sets: SetOut[];
}

export interface Health {
  status: string;
  database: string;
}

export type Muscle =
  | "chest"
  | "shoulders"
  | "biceps"
  | "triceps"
  | "forearms"
  | "abs"
  | "obliques"
  | "traps"
  | "lats"
  | "lower_back"
  | "glutes"
  | "quads"
  | "hamstrings"
  | "calves";

export interface MuscleStatus {
  fatigue: number; // 0 = recovered, 1 = just trained hard
  last_trained: string | null;
  days_since: number | null;
}

export interface WhoopToday {
  date: string;
  recovery_score: number | null;
  hrv_rmssd_ms: number | null;
  resting_hr: number | null;
  sleep_hours: number | null;
  sleep_performance: number | null;
  strain: number | null;
  steps: number | null;
}

export interface BodyStatus {
  today: string;
  recovery_days: number;
  muscles: Record<Muscle, MuscleStatus>;
  whoop: WhoopToday | null;
}

export function localDateISO(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export interface Me {
  logged_in: boolean;
}

/** Thrown when the session is missing or expired, so the app can show login. */
export class UnauthorizedError extends Error {}

let onUnauthorized: () => void = () => {};
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
  if (res.status === 401) {
    onUnauthorized();
    throw new UnauthorizedError("Not logged in");
  }
  if (res.status === 204) return undefined as T;
  if (!res.ok) {
    const detail = await res
      .json()
      .then((b: { detail?: unknown }) => (typeof b.detail === "string" ? b.detail : ""))
      .catch(() => "");
    throw new Error(`${res.status} ${detail || res.statusText}`);
  }
  return res.json() as Promise<T>;
}

const get = <T,>(path: string) => request<T>(path);
const post = <T,>(path: string, body?: unknown) =>
  request<T>(path, { method: "POST", body: JSON.stringify(body ?? {}) });
const del = (path: string) => request<void>(path, { method: "DELETE" });
const today = () => localDateISO();

export const api = {
  health: () => get<Health>("/api/health"),
  me: () => get<Me>("/api/auth/me"),
  login: (password: string) => post<Me>("/api/auth/login", { password }),
  logout: () => post<Me>("/api/auth/logout"),
  body: () => get<BodyStatus>(`/api/body?today=${localDateISO()}`),
  workouts: (year: number, month: number) =>
    get<Workout[]>(`/api/workouts?year=${year}&month=${month}`),
  day: (date: string) => get<DayDetail>(`/api/day/${date}`),
  summary: () => get<Summary>(`/api/summary?today=${today()}`),
  template: (split?: SplitDay) =>
    get<LogTemplate>(`/api/log/template?today=${today()}${split ? `&split_day=${split}` : ""}`),
  createExercise: (body: { name: string; split_day: SplitDay; muscles: Muscle[] }) =>
    post<Exercise>("/api/exercises", body),
  createWorkout: (body: NewWorkout) => post<Workout>("/api/workouts", body),
  deleteWorkout: (id: number) => del(`/api/workouts/${id}`),
  lifts: () => get<LiftSummary[]>("/api/progress/lifts"),
  lift: (id: number) => get<LiftProgress>(`/api/progress/lift/${id}?today=${today()}`),
  volume: (weeks = 4) => get<VolumeWeek[]>(`/api/progress/volume?today=${today()}&weeks=${weeks}`),
  lab: () => get<Lab>(`/api/lab?today=${today()}`),
};


// --- Calendar ---------------------------------------------------------------

export interface DaySet {
  set_number: number;
  weight: number;
  reps: number;
  rir: number | null;
  e1rm: number;
  is_pr: boolean;
}

export interface DayExercise {
  exercise_id: number;
  name: string;
  sets: DaySet[];
}

export interface DayWorkout {
  id: number;
  split_day: SplitDay;
  notes: string | null;
  exercises: DayExercise[];
  total_sets: number;
  pr_count: number;
}

export interface DayDetail {
  date: string;
  workouts: DayWorkout[];
  whoop: WhoopToday | null;
}

export interface Summary {
  this_week: number;
  this_month: number;
  total: number;
  last_workout: string | null;
}

// --- Logging ----------------------------------------------------------------

export interface Exercise {
  id: number;
  name: string;
  split_day: SplitDay;
  equipment: string | null;
  muscles: Muscle[];
  active: boolean;
}

export interface LastSet {
  set_number: number;
  weight: number;
  reps: number;
  rir: number | null;
}

export interface TemplateExercise {
  id: number;
  name: string;
  muscles: Muscle[];
  last_date: string | null;
  last_sets: LastSet[];
}

export interface LogTemplate {
  split_day: SplitDay;
  suggested_split: SplitDay;
  exercises: TemplateExercise[];
}

export interface NewWorkout {
  date: string;
  split_day: SplitDay;
  notes?: string | null;
  sets: { exercise_id: number; set_number: number; weight: number; reps: number; rir: number | null }[];
}

// --- Progress ---------------------------------------------------------------

export interface LiftSummary {
  exercise_id: number;
  name: string;
  split_day: SplitDay;
  sessions: number;
  best_e1rm: number | null;
  current_estimate: number | null;
}

export interface SeriesPoint {
  date: string;
  observed: number;
  estimate: number;
  lower: number;
  upper: number;
}

export interface TrendOut {
  status: "improving" | "plateau" | "declining" | "unclear" | "not_enough_data";
  pct_per_week: number | null;
  ci_low: number | null;
  ci_high: number | null;
  sessions: number;
  window_days: number;
}

export interface LiftProgress {
  exercise_id: number;
  name: string;
  unit: string;
  series: SeriesPoint[];
  today_estimate: number | null;
  today_lower: number | null;
  today_upper: number | null;
  fitted: boolean;
  noise_pct: number | null;
  drift_pct_per_week: number | null;
  best_e1rm: number | null;
  best_e1rm_date: string | null;
  heaviest_weight: number | null;
  heaviest_weight_date: string | null;
  trend: TrendOut;
}

export interface VolumeWeek {
  week_start: string;
  sets: Partial<Record<Muscle, number>>;
}

// --- Lab --------------------------------------------------------------------

export interface LabModel {
  key: string;
  name: string;
  question: string;
  status: "live" | "collecting" | "planned";
  progress: number | null;
  progress_label: string | null;
  headline: string | null;
  doc: string;
}

export interface Lab {
  models: LabModel[];
  plateaus: { exercise_id: number; name: string; trend: TrendOut }[];
}

export const MUSCLE_LABELS: Record<Muscle, string> = {
  chest: "Chest",
  shoulders: "Shoulders",
  biceps: "Biceps",
  triceps: "Triceps",
  forearms: "Forearms",
  abs: "Abs",
  obliques: "Obliques",
  traps: "Traps",
  lats: "Lats",
  lower_back: "Lower back",
  glutes: "Glutes",
  quads: "Quads",
  hamstrings: "Hamstrings",
  calves: "Calves",
};

export const ALL_MUSCLES = Object.keys(MUSCLE_LABELS) as Muscle[];

export function prettyDate(iso: string, opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" }) {
  return new Date(iso + "T00:00").toLocaleDateString(undefined, opts);
}
