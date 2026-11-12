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
  workouts: (year: number, month: number) =>
    get<Workout[]>(`/api/workouts?year=${year}&month=${month}`),
};
