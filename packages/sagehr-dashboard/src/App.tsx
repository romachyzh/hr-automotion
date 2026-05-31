import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchDashboard, logout, UnauthorizedError } from "./api";
import type { DashboardEmployeeRow, DashboardReport } from "./types";
import { Login } from "./Login";
import { DashboardTable, policyKey, type SortState } from "./DashboardTable";
import { SummaryCards, type Summary } from "./SummaryCards";
import { DashboardSkeleton } from "./Skeleton";

export function App() {
  const [authed, setAuthed] = useState(true); // assume yes; flip to false on 401
  const [report, setReport] = useState<DashboardReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Server-side filters (trigger a refetch)
  const [teamId, setTeamId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  // Client-side controls (no refetch)
  const [groupByTeam, setGroupByTeam] = useState(false);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortState>({ key: "total", dir: "desc" });

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
      if (err instanceof UnauthorizedError) setAuthed(false);
      else setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [teamId, from, to]);

  useEffect(() => {
    if (authed) void load();
  }, [authed, load]);

  const onSort = useCallback((key: string) => {
    setSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === "asc" ? "desc" : "asc" }
        : { key, dir: key === "name" ? "asc" : "desc" },
    );
  }, []);

  const visibleRows = useMemo(() => {
    if (!report) return [];
    const needle = search.trim().toLowerCase();
    const filtered = needle
      ? report.employees.filter((e) => e.name.toLowerCase().includes(needle))
      : report.employees.slice();
    filtered.sort((a, b) => {
      const av = sortValue(a, sort.key);
      const bv = sortValue(b, sort.key);
      let cmp: number;
      if (typeof av === "number" && typeof bv === "number") cmp = av - bv;
      else cmp = String(av).localeCompare(String(bv));
      return sort.dir === "asc" ? cmp : -cmp;
    });
    return filtered;
  }, [report, search, sort]);

  const summary: Summary = useMemo(() => {
    let used = 0;
    let remaining = 0;
    let overQuota = 0;
    for (const r of visibleRows) {
      used += r.totals.used;
      if (r.totals.remaining !== null) remaining += r.totals.remaining;
      if (r.totals.remaining !== null && r.totals.remaining < 0) overQuota += 1;
    }
    return { people: visibleRows.length, used: round1(used), remaining: round1(remaining), overQuota };
  }, [visibleRows]);

  if (!authed) {
    return <Login onSuccess={() => setAuthed(true)} />;
  }

  const teamOptions = report?.teams ?? [];

  return (
    <div className="app">
      <div className="toolbar">
        <h1>
          <span className="dot" />
          Leave Dashboard
        </h1>

        <label className="search">
          <span className="icon">⌕</span>
          <input
            type="text"
            placeholder="Search employee…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>

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

        <label className="toggle">
          <input
            type="checkbox"
            checked={groupByTeam}
            onChange={(e) => setGroupByTeam(e.target.checked)}
          />
          Group by team
        </label>

        <button className="ghost" onClick={() => void load()} disabled={loading}>
          {loading ? "Loading…" : "↻ Refresh"}
        </button>
        <button className="ghost" onClick={() => void logout().then(() => setAuthed(false))}>
          Sign out
        </button>
      </div>

      {error && <p className="error">{error}</p>}

      {loading ? (
        <DashboardSkeleton />
      ) : report ? (
        <>
          <SummaryCards summary={summary} />
          <div className={`banner${report.balances_available ? "" : " warn"}`}>
            <span className="pill">
              {report.range.from} → {report.range.to}
            </span>
            <span>{report.day_counting.basis.replace("_", " ")}</span>
            <span>·</span>
            <span>
              {report.balances_available
                ? "remaining from SageHR balances"
                : "balances unavailable — remaining computed (allowance − used)"}
            </span>
          </div>
          <DashboardTable
            policies={report.policies}
            rows={visibleRows}
            groupByTeam={groupByTeam}
            sort={sort}
            onSort={onSort}
          />
        </>
      ) : null}
    </div>
  );
}

function sortValue(row: DashboardEmployeeRow, key: string): number | string {
  if (key === "name") return row.name.toLowerCase();
  if (key === "total") return row.totals.used;
  if (key.startsWith("pol:")) {
    const pk = key.slice(4);
    const cell = row.by_policy.find((c) => policyKey(c.policy_id) === pk);
    return cell?.used ?? 0;
  }
  return 0;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
