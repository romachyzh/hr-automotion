import { useCallback, useEffect, useState } from "react";
import { fetchDashboard, logout, UnauthorizedError } from "./api";
import type { DashboardReport } from "./types";
import { Login } from "./Login";
import { DashboardTable } from "./DashboardTable";

export function App() {
  const [authed, setAuthed] = useState(true); // assume yes; flip to false on 401
  const [report, setReport] = useState<DashboardReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [teamId, setTeamId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [groupByTeam, setGroupByTeam] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchDashboard({
        teamId: teamId || undefined,
        from: from || undefined,
        to: to || undefined,
      });
      setReport(data);
      setAuthed(true);
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        setAuthed(false);
      } else {
        setError(err instanceof Error ? err.message : "Failed to load");
      }
    } finally {
      setLoading(false);
    }
  }, [teamId, from, to]);

  useEffect(() => {
    if (authed) void load();
  }, [authed, load]);

  if (!authed) {
    return <Login onSuccess={() => setAuthed(true)} />;
  }

  // Team options come from the report itself (full tenant team list).
  const teamOptions = report?.teams ?? [];

  return (
    <div className="app">
      <div className="toolbar">
        <h1>Leave Dashboard</h1>

        <label className="field">
          Team
          <select value={teamId} onChange={(e) => setTeamId(e.target.value)}>
            <option value="">All teams</option>
            {teamOptions.map((t) => (
              <option key={String(t.team_id)} value={String(t.team_id ?? "")}>
                {t.name ?? `Team ${String(t.team_id)}`}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          From
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="field">
          To
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>

        <label className="field">
          Group
          <span style={{ display: "flex", alignItems: "center", gap: 4, height: 32 }}>
            <input
              type="checkbox"
              checked={groupByTeam}
              onChange={(e) => setGroupByTeam(e.target.checked)}
            />
            by team
          </span>
        </label>

        <button onClick={() => void logout().then(() => setAuthed(false))}>Sign out</button>
      </div>

      {report && (
        <p className="notice" style={{ background: "#eef7ee", borderColor: "#cfe8cf" }}>
          {report.range.from} → {report.range.to} · {report.day_counting.basis.replace("_", " ")} ·{" "}
          {report.employees.length} employees
          {!report.balances_available &&
            " · balances endpoint unavailable, remaining is computed (allowance − used)*"}
        </p>
      )}

      {error && <p className="error">{error}</p>}
      {loading && !report && <p>Loading…</p>}

      {report && <DashboardTable report={report} groupByTeam={groupByTeam} />}
    </div>
  );
}
