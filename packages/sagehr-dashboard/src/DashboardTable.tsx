import type { ReactNode } from "react";
import type { DashboardEmployeeRow, DashboardPolicy } from "./types";

export type SortDir = "asc" | "desc";
export interface SortState {
  key: string;
  dir: SortDir;
}

export function policyKey(id: string | number | null): string {
  return id != null ? String(id) : "unknown";
}

function fmt(n: number | null): string {
  if (n === null) return "—";
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("") || "?";
}

function cellFor(row: DashboardEmployeeRow, policy: DashboardPolicy) {
  const key = policyKey(policy.policy_id);
  return row.by_policy.find((c) => policyKey(c.policy_id) === key);
}

/** A used / bar / remaining cell. */
function UsageCell({
  used,
  remaining,
  allowance,
}: {
  used: number;
  remaining: number | null;
  allowance: number | null;
}) {
  const hasBar = allowance !== null && allowance > 0;
  const pct = hasBar ? Math.min(100, Math.max(0, (used / allowance) * 100)) : 0;
  const over = remaining !== null && remaining < 0;
  return (
    <div className="cell">
      <div className="nums">
        <span className="used">{fmt(used)}</span>
        <span className={`rem${remaining === null ? " muted" : over ? " neg" : ""}`}>
          {fmt(remaining)}
        </span>
      </div>
      {hasBar && (
        <div className={`bar${over ? " over" : ""}`}>
          <span style={{ width: `${over ? 100 : pct}%` }} />
        </div>
      )}
    </div>
  );
}

function SortHeader({
  label,
  sortKey,
  sort,
  onSort,
  className,
}: {
  label: string;
  sortKey: string;
  sort: SortState;
  onSort: (key: string) => void;
  className?: string;
}) {
  const active = sort.key === sortKey;
  return (
    <th
      className={`sortable${className ? ` ${className}` : ""}${active ? " active" : ""}`}
      onClick={() => onSort(sortKey)}
      title="Click to sort"
    >
      {label}
      <span className="arrow">{active ? (sort.dir === "asc" ? "▲" : "▼") : "▾"}</span>
    </th>
  );
}

function EmployeeRow({
  row,
  policies,
}: {
  row: DashboardEmployeeRow;
  policies: DashboardPolicy[];
}) {
  const totalOver = row.totals.remaining !== null && row.totals.remaining < 0;
  return (
    <tr>
      <td className="name">
        <span className="avatar">{initials(row.name)}</span>
        {row.name}
      </td>
      {policies.map((p) => {
        const cell = cellFor(row, p);
        return (
          <td key={policyKey(p.policy_id)} className="num">
            <UsageCell
              used={cell?.used ?? 0}
              remaining={cell ? cell.remaining : null}
              allowance={cell?.allowance ?? p.default_allowance}
            />
          </td>
        );
      })}
      <td className="num">
        <div className="cell">
          <div className="nums">
            <span className="used">{fmt(row.totals.used)}</span>
            <span className={`total-rem${totalOver ? " neg" : ""}`}>{fmt(row.totals.remaining)}</span>
          </div>
        </div>
      </td>
    </tr>
  );
}

export function DashboardTable({
  policies,
  rows,
  groupByTeam,
  sort,
  onSort,
}: {
  policies: DashboardPolicy[];
  rows: DashboardEmployeeRow[];
  groupByTeam: boolean;
  sort: SortState;
  onSort: (key: string) => void;
}) {
  const colCount = 1 + policies.length + 1;
  const groups = groupByTeam ? groupRows(rows) : null;

  return (
    <div className="table-card">
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <SortHeader label="Employee" sortKey="name" sort={sort} onSort={onSort} />
              {policies.map((p) => (
                <SortHeader
                  key={policyKey(p.policy_id)}
                  label={p.policy ?? `Policy ${policyKey(p.policy_id)}`}
                  sortKey={`pol:${policyKey(p.policy_id)}`}
                  sort={sort}
                  onSort={onSort}
                  className="num"
                />
              ))}
              <SortHeader label="Total" sortKey="total" sort={sort} onSort={onSort} className="num" />
            </tr>
          </thead>
          <tbody>
            {groups
              ? groups.map((g) => (
                  <Group key={g.key} title={g.name} count={g.rows.length} colSpan={colCount}>
                    {g.rows.map((row) => (
                      <EmployeeRow key={String(row.employee_id)} row={row} policies={policies} />
                    ))}
                  </Group>
                ))
              : rows.map((row) => (
                  <EmployeeRow key={String(row.employee_id)} row={row} policies={policies} />
                ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={colCount} className="empty">
                  No employees match.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Group({
  title,
  count,
  colSpan,
  children,
}: {
  title: string;
  count: number;
  colSpan: number;
  children: ReactNode;
}) {
  return (
    <>
      <tr className="team-header">
        <td colSpan={colSpan}>
          {title} <span className="meta">· {count} {count === 1 ? "person" : "people"}</span>
        </td>
      </tr>
      {children}
    </>
  );
}

interface TeamGroup {
  key: string;
  name: string;
  rows: DashboardEmployeeRow[];
}

function groupRows(rows: DashboardEmployeeRow[]): TeamGroup[] {
  const map = new Map<string, TeamGroup>();
  for (const row of rows) {
    const key = row.team_id != null ? String(row.team_id) : "none";
    let group = map.get(key);
    if (!group) {
      group = { key, name: row.team ?? "No team", rows: [] };
      map.set(key, group);
    }
    group.rows.push(row);
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
}
