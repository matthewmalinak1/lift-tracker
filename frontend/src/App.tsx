import { useEffect, useState } from "react";
import { api, setUnauthorizedHandler, type Health } from "./api";
import Body from "./components/Body";
import Calendar from "./components/Calendar";
import Login from "./components/Login";

type Tab = "body" | "calendar" | "log" | "progress";

const TABS: { id: Tab; label: string }[] = [
  { id: "body", label: "Body" },
  { id: "calendar", label: "Calendar" },
  { id: "log", label: "Log" },
  { id: "progress", label: "Progress" },
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
  const [tab, setTab] = useState<Tab>("body");
  const [health, setHealth] = useState<Health | null>(null);
  // null = still checking, so we don't flash the login screen on every open.
  const [loggedIn, setLoggedIn] = useState<boolean | null>(null);

  useEffect(() => {
    setUnauthorizedHandler(() => setLoggedIn(false));
    api.health().then(setHealth).catch(() => setHealth(null));
    api
      .me()
      .then((m) => setLoggedIn(m.logged_in))
      .catch(() => setLoggedIn(false));
  }, []);

  const online = health?.database === "ok";

  if (loggedIn === null) return <div className="app" />;
  if (!loggedIn) return <Login onSuccess={() => setLoggedIn(true)} />;

  const logout = async () => {
    await api.logout().catch(() => {});
    setLoggedIn(false);
  };

  return (
    <div className="app">
      <header className="top-bar">
        <h1>Lift Tracker</h1>
        <div className="top-actions">
          <span
            className={`status-dot ${online ? "on" : "off"}`}
            title={online ? "API + database connected" : "Database not connected"}
          />
          <button className="text-btn" onClick={logout}>
            Log out
          </button>
        </div>
      </header>

      <main>
        {tab === "body" && <Body />}
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
