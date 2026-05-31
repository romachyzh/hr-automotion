import { useState } from "react";
import type { FormEvent } from "react";
import { login, UnauthorizedError } from "./api";

export function Login({ onSuccess }: { onSuccess: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(password);
      onSuccess();
    } catch (err) {
      setError(err instanceof UnauthorizedError ? "Incorrect password" : "Login failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-wrap">
      <form className="login" onSubmit={submit}>
        <div className="brand">
          <span className="dot" />
          <h1>Leave Dashboard</h1>
        </div>
        <p className="sub">Enter the password to view leave usage.</p>
        <input
          type="password"
          placeholder="Password"
          value={password}
          autoFocus
          onChange={(e) => setPassword(e.target.value)}
        />
        <button type="submit" disabled={busy || password.length === 0}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
        {error && <p className="error">{error}</p>}
      </form>
    </div>
  );
}
