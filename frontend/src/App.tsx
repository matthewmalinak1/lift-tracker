import { useEffect, useState } from "react";
import { api, setUnauthorizedHandler, type Health } from "./api";
import Body from "./components/Body";
import Calendar from "./components/Calendar";
import LabView from "./components/LabView";
import LogWorkout from "./components/LogWorkout";
import Login from "./components/Login";
import Logo from "./components/Logo";
import Progress, { type ProgressView } from "./components/Progress";
import Sheet from "./components/Sheet";

type Tab = "body" | "calendar" | "progress" | "lab";

const TABS: { id: Tab; label: string }[] = [
  { id: "body", label: "Body" },
  { id: "calendar", label: "Calendar" },
  { id: "progress", label: "Progress" },
  { id: "lab", label: "Lab" },
];

export default function App() {
  const [tab, setTab] = useState<Tab>("body");
  const [progressView, setProgressView] = useState<ProgressView>("strength");
  const [health, setHealth] = useState<Health | null>(null);
  // null = still checking, so we don't flash the login screen on every open.
  const [loggedIn, setLoggedIn] = useState<boolean | null>(null);
  const [logging, setLogging] = useState(false);
  // Bumped after any change to the data so every screen reloads.
  const [version, setVersion] = useState(0);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    setUnauthorizedHandler(() => setLoggedIn(false));
    api.health().then(setHealth).catch(() => setHealth(null));
    api
      .me()
      .then((m) => setLoggedIn(m.logged_in))
      .catch(() => setLoggedIn(false));
  }, []);

  // Coming back from WHOOP's consent page: /?whoop=connected|denied|error
  useEffect(() => {
    const result = new URLSearchParams(window.location.search).get("whoop");
    if (!result) return;
    setToast(
      result === "connected"
        ? "WHOOP connected"
        : result === "denied"
          ? "WHOOP connection cancelled"
          : "WHOOP connection failed; try again",
    );
    window.history.replaceState(null, "", "/");
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2500);
    return () => clearTimeout(t);
  }, [toast]);

  const online = health?.database === "ok";

  if (loggedIn === null) return <div className="app" />;
  if (!loggedIn) return <Login onSuccess={() => setLoggedIn(true)} />;

  const logout = async () => {
    await api.logout().catch(() => {});
    setLoggedIn(false);
  };
  const changed = () => setVersion((v) => v + 1);

  return (
    <div className="app">
      <header className="top-bar">
        <h1 className="brand">
          <Logo height={30} />
        </h1>
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

      <main key={version}>
        {tab === "body" && (
          <Body
            onLogWeight={() => {
              setProgressView("weight");
              setTab("progress");
            }}
          />
        )}
        {tab === "calendar" && <Calendar onChanged={changed} />}
        {tab === "progress" && <Progress view={progressView} onView={setProgressView} />}
        {tab === "lab" && <LabView />}
      </main>

      <button className="fab" onClick={() => setLogging(true)} aria-label="Log a workout">
        <span>+</span> Log
      </button>

      <Sheet open={logging} onClose={() => setLogging(false)} full>
        <LogWorkout
          onClose={() => setLogging(false)}
          onSaved={() => {
            setLogging(false);
            setToast("Workout saved");
            changed();
          }}
        />
      </Sheet>

      {toast && <div className="toast">{toast}</div>}

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
