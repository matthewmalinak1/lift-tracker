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

export const api = {
  health: () => get<Health>("/api/health"),
  me: () => get<Me>("/api/auth/me"),
  login: (password: string) => post<Me>("/api/auth/login", { password }),
  logout: () => post<Me>("/api/auth/logout"),
  body: () => get<BodyStatus>(`/api/body?today=${localDateISO()}`),
  workouts: (year: number, month: number) =>
    get<Workout[]>(`/api/workouts?year=${year}&month=${month}`),
};
