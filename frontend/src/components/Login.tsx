import { useState, type FormEvent } from "react";
import { api, UnauthorizedError } from "../api";

export default function Login({ onSuccess }: { onSuccess: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.login(password);
      onSuccess();
    } catch (err) {
      setError(
        err instanceof UnauthorizedError
          ? "Wrong password."
          : String(err).includes("503")
            ? String(err).replace(/^Error: 503 /, "") + " (set it in Vercel, then redeploy)."
            : "Couldn't reach the server.",
      );
      setPassword("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login">
      <img src="/icon-192.png" alt="" className="login-icon" />
      <h1>Lift Tracker</h1>
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
        {error && <p className="error">{error}</p>}
      </form>
    </div>
  );
}
