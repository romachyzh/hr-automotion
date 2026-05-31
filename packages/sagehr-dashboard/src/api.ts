import type { DashboardReport } from "./types";

/** Thrown when the API responds 401 — the UI should show the login screen. */
export class UnauthorizedError extends Error {
  constructor() {
    super("Not authenticated");
    this.name = "UnauthorizedError";
  }
}

export interface DashboardQuery {
  from?: string;
  to?: string;
  teamId?: string;
}

export async function fetchDashboard(query: DashboardQuery = {}): Promise<DashboardReport> {
  const params = new URLSearchParams();
  if (query.from) params.set("from", query.from);
  if (query.to) params.set("to", query.to);
  if (query.teamId) params.set("team_id", query.teamId);
  const qs = params.toString();
  const res = await fetch(`/api/dashboard${qs ? `?${qs}` : ""}`, {
    credentials: "same-origin",
  });
  if (res.status === 401) throw new UnauthorizedError();
  if (!res.ok) throw new Error(`Dashboard request failed: ${res.status}`);
  return (await res.json()) as DashboardReport;
}

export async function login(password: string): Promise<void> {
  const res = await fetch("/api/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ password }),
  });
  if (res.status === 401) throw new UnauthorizedError();
  if (!res.ok) throw new Error(`Login failed: ${res.status}`);
}

export async function logout(): Promise<void> {
  await fetch("/api/logout", { method: "POST", credentials: "same-origin" });
}
