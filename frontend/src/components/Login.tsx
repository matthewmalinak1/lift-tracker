import { useState, type FormEvent } from "react";
import { api, UnauthorizedError } from "../api";
import Logo from "./Logo";
import PatternLock from "./PatternLock";

function describe(err: unknown): string {
  if (err instanceof UnauthorizedError) return "Wrong password.";
  if (String(err).includes("503")) {
    return String(err).replace(/^Error: 503 /, "") + " (set it in Vercel, then redeploy).";
  }
  return "Couldn't reach the server.";
}

export default function Login({ onSuccess }: { onSuccess: () => void }) {
  const [mode, setMode] = useState<"pattern" | "type">("pattern");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const attempt = async (secret: string): Promise<boolean> => {
    setError(null);
    try {
      await api.login(secret);
      // Let the success glow show for a beat before switching screens.
      setTimeout(onSuccess, 350);
      return true;
    } catch (err) {
      if (!(err instanceof UnauthorizedError)) setError(describe(err));
      return false;
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const ok = await attempt(password);
    if (!ok) {
      setError((prev) => prev ?? "Wrong password.");
      setPassword("");
    }
    setBusy(false);
  };

  return (
    <div className="login">
      <Logo height={56} />
      <p className="login-sub">Strength · Recovery · Signal</p>

      {mode === "pattern" ? (
        <PatternLock onComplete={attempt} />
      ) : (
        <form onSubmit={submit}>
          <input
            type="password"
            autoComplete="current-password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus
          />
          <button type="submit" className="primary" disabled={busy || !password}>
            {busy ? "Checking…" : "Log in"}
          </button>
        </form>
      )}

      {error && <p className="error">{error}</p>}

      <button
        className="text-btn"
        onClick={() => {
          setError(null);
          setMode(mode === "pattern" ? "type" : "pattern");
        }}
      >
        {mode === "pattern" ? "Type password instead" : "Use pattern instead"}
      </button>
    </div>
  );
}
