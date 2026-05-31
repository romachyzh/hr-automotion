import type { ReactNode } from "react";
import type { DashboardEmployeeRow, DashboardPolicy, DashboardReport } from "./types";

function policyKey(id: string | number | null): string {
  return id != null ? String(id) : "unknown";
}

function fmt(n: number | null): string {
  if (n === null) return "—";
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function cellFor(row: DashboardEmployeeRow, policy: DashboardPolicy) {
  const key = policyKey(policy.policy_id);
  return row.by_policy.find((c) => policyKey(c.policy_id) === key);
}

function EmployeeRow({ row, policies }: { row: DashboardEmployeeRow; policies: DashboardPolicy[] }) {
  return (
    <tr>
      <td>{row.name}</td>
      {policies.map((p) => {
        const cell = cellFor(row, p);
        const used = cell ? cell.used : 0;
        const remaining = cell ? cell.remaining : null;
        const computed = cell?.remaining_source === "computed";
        return (
          <ConsecutiveCells
            key={policyKey(p.policy_id)}
            used={used}
            remaining={remaining}
            computed={computed}
          />
        );
      })}
      <td className="num used">{fmt(row.totals.used)}</td>
      <td className="num remaining">{fmt(row.totals.remaining)}</td>
    </tr>
  );
}

function ConsecutiveCells({
  used,
  remaining,
  computed,
}: {
  used: number;
  remaining: number | null;
  computed: boolean;
}) {
  return (
    <>
      <td className="num used">{fmt(used)}</td>
      <td
        className={`num remaining${remaining === null ? " null" : ""}${computed ? " source-computed" : ""}`}
        title={computed ? "Remaining computed from allowance − used (no balance from SageHR)" : undefined}
      >
        {fmt(remaining)}
        {computed ? "*" : ""}
      </td>
    </>
  );
}

export function DashboardTable({
  report,
  groupByTeam,
}: {
  report: DashboardReport;
  groupByTeam: boolean;
}) {
  const { policies, employees } = report;
  const colCount = 1 + policies.length * 2 + 2;

  const groups = groupByTeam ? groupByTeamName(employees) : null;

  return (
    <table>
      <thead>
        <tr>
          <th rowSpan={2}>Employee</th>
          {policies.map((p) => (
            <th key={policyKey(p.policy_id)} colSpan={2} className="num">
              {p.policy ?? `Policy ${policyKey(p.policy_id)}`}
            </th>
          ))}
          <th colSpan={2} className="num">
            Total
          </th>
        </tr>
        <tr>
          {policies.map((p) => (
            <SubHeaders key={policyKey(p.policy_id)} />
          ))}
          <th className="num">Used</th>
          <th className="num">Rem</th>
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
          : employees.map((row) => (
              <EmployeeRow key={String(row.employee_id)} row={row} policies={policies} />
            ))}
        {employees.length === 0 && (
          <tr>
            <td colSpan={colCount}>No employees in range.</td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

function SubHeaders() {
  return (
    <>
      <th className="num">Used</th>
      <th className="num">Rem</th>
    </>
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
          {title} · {count} {count === 1 ? "person" : "people"}
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

function groupByTeamName(rows: DashboardEmployeeRow[]): TeamGroup[] {
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
