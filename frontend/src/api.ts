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

async function get<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

export const api = {
  health: () => get<Health>("/api/health"),
  workouts: (year: number, month: number) =>
    get<Workout[]>(`/api/workouts?year=${year}&month=${month}`),
};
