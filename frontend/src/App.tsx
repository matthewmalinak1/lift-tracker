import { useEffect, useState } from "react";
import { api, type Health } from "./api";
import Calendar from "./components/Calendar";

type Tab = "calendar" | "log" | "progress" | "recovery";

const TABS: { id: Tab; label: string }[] = [
  { id: "calendar", label: "Calendar" },
  { id: "log", label: "Log" },
  { id: "progress", label: "Progress" },
  { id: "recovery", label: "Recovery" },
];

function Placeholder({ title, phase, text }: { title: string; phase: string; text: string }) {
  return (
    <section className="card">
      <h2>{title}</h2>
      <p className="accent">{phase}</p>
      <p className="muted">{text}</p>
    </section>
  );
}

export default function App() {
  const [tab, setTab] = useState<Tab>("calendar");
  const [health, setHealth] = useState<Health | null>(null);

  useEffect(() => {
    api.health().then(setHealth).catch(() => setHealth(null));
  }, []);

  const online = health?.database === "ok";

  return (
    <div className="app">
      <header className="top-bar">
        <h1>Lift Tracker</h1>
        <span className={`status-dot ${online ? "on" : "off"}`} title={online ? "API + database connected" : "API offline"} />
      </header>

      <main>
        {tab === "calendar" && <Calendar />}
        {tab === "log" && (
          <Placeholder
            title="Log a workout"
            phase="Phase 1"
            text="Pick today's split, then enter weight × reps (and RIR) for your 2 sets per exercise, with last session's numbers shown as a target."
          />
        )}
        {tab === "progress" && (
          <Placeholder
            title="Strength progress"
            phase="Phase 3"
            text="Estimated 1RM per lift, smoothed with a Kalman filter and shown with confidence bands."
          />
        )}
        {tab === "recovery" && (
          <Placeholder
            title="WHOOP"
            phase="Phase 2"
            text="Recovery, HRV, sleep, strain and steps synced daily from the WHOOP API."
          />
        )}
      </main>

      <nav className="tab-bar">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={t.id === tab ? "active" : ""}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>
    </div>
  );
}
