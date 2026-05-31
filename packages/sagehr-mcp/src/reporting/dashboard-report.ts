/**
 * Dashboard data service.
 *
 * Builds the per-employee, per-policy leave report that backs the web
 * dashboard: days-off USED (approved, business days, YTD by default) and
 * REMAINING ("free") days, with per-team and per-policy roll-ups for grouping.
 *
 * Data sources (all via the typed client):
 *   • /teams                          — team id → name
 *   • /employees                      — directory (+ team_id / team name)
 *   • /leave-management/policies      — policy id → name, unit, allowance
 *   • /leave-management/requests      — ONE tenant-wide chunked pass for "used"
 *   • /employees/{id}/leave-balances  — "remaining", one call per employee
 *
 * Remaining is balances-with-fallback: we probe the balances endpoint on the
 * first employee; if it 404s/throws the endpoint is treated as unavailable
 * tenant-wide and remaining is computed as `default_allowance − used`. When a
 * balance row is missing for a specific policy we also fall back to computed.
 * Each cell records which source produced it (`remaining_source`).
 */
import type {
  SageHRClient,
  Employee,
  LeaveBalance,
  LeaveRequest,
  LeaveDaysOptions,
} from "@hr-automotion/sagehr-client";
import {
  aggregateByPolicy,
  defaultYearStart,
  describeDayCounting,
  todayISO,
} from "./leave-aggregation.js";

/** Balances are per-employee; cap concurrent calls so we don't hammer SageHR. */
const BALANCE_CONCURRENCY = 6;

export type RemainingSource = "balances" | "computed" | "unknown";

export interface DashboardParams {
  /** Inclusive ISO start. Defaults to Jan 1 of the current year. */
  from?: string;
  /** Inclusive ISO end. Defaults to today. */
  to?: string;
  /** Restrict to a single team (matched against employee.team_id). */
  teamId?: number | string;
  /** Working-day controls forwarded to computeLeaveDays. */
  dayOpts?: LeaveDaysOptions;
}

export interface DashboardPolicy {
  policy_id: string | number | null;
  policy: string | null;
  unit: string | null;
  default_allowance: number | null;
}

export interface DashboardTeam {
  team_id: string | number | null;
  name: string | null;
}

export interface EmployeePolicyCell {
  policy_id: string | number | null;
  policy: string | null;
  used: number;
  remaining: number | null;
  allowance: number | null;
  remaining_source: RemainingSource;
}

export interface DashboardEmployeeRow {
  employee_id: string | number;
  name: string;
  team_id: string | number | null;
  team: string | null;
  by_policy: EmployeePolicyCell[];
  totals: { used: number; remaining: number | null };
}

export interface PolicyRollup {
  policy_id: string | number | null;
  policy: string | null;
  used: number;
  remaining: number | null;
}

export interface TeamRollup {
  team_id: string | number | null;
  name: string | null;
  employee_count: number;
  by_policy: PolicyRollup[];
}

export interface DashboardReport {
  generated_at: string;
  range: { from: string; to: string };
  day_counting: ReturnType<typeof describeDayCounting>;
  balances_available: boolean;
  policies: DashboardPolicy[];
  teams: DashboardTeam[];
  employees: DashboardEmployeeRow[];
  by_team: TeamRollup[];
  by_policy: PolicyRollup[];
}

interface PolicyMeta {
  policy_id: string | number | null;
  name: string | null;
  unit: string | null;
  allowance: number | null;
}

export async function buildDashboardReport(
  client: SageHRClient,
  params: DashboardParams = {},
): Promise<DashboardReport> {
  const from = params.from ?? defaultYearStart();
  // Default to the full allowance year, not YTD: SageHR's "used"/"available"
  // figures count the whole allowance period (including approved future
  // bookings), so to match them we must include the rest of the year.
  const to = params.to ?? defaultYearEnd();
  const dayOpts = params.dayOpts ?? {};
  const teamFilter = params.teamId != null ? String(params.teamId) : null;

  // --- Reference data (tolerate endpoints that fail on a given tenant) ---
  const [policyList, teamList] = await Promise.all([
    client.policies.list().catch(() => []),
    client.teams.list().catch(() => []),
  ]);

  const policyMeta = new Map<string, PolicyMeta>();
  for (const p of policyList) {
    policyMeta.set(String(p.id), {
      policy_id: p.id,
      name: typeof p.name === "string" ? p.name : null,
      unit: typeof p.unit === "string" ? p.unit : null,
      allowance: toNumberOrNull(p.default_allowance),
    });
  }
  const policyNameById = new Map<string, string>();
  for (const [id, meta] of policyMeta) {
    if (meta.name) policyNameById.set(id, meta.name);
  }

  const teamNameById = new Map<string, string>();
  for (const t of teamList) {
    if (typeof t.name === "string") teamNameById.set(String(t.id), t.name);
  }

  // --- Employees (optionally scoped to one team) ---
  const employees: Employee[] = [];
  for await (const emp of client.employees.listAll(
    teamFilter != null ? { team_id: params.teamId, page_size: 100 } : { page_size: 100 },
  )) {
    // SageHR may or may not honour the team_id filter; enforce client-side too.
    if (teamFilter != null && String(emp.team_id ?? "") !== teamFilter) continue;
    employees.push(emp);
  }
  const employeeIds = new Set(employees.map((e) => String(e.id)));

  // --- Leave requests: ONE tenant-wide chunked pass, bucketed per employee ---
  const requestsByEmployee = new Map<string, LeaveRequest[]>();
  for await (const req of client.leaveRequests.listAll({ from, to })) {
    const key = String(req.employee_id);
    if (!employeeIds.has(key)) continue; // ignore people outside our employee set
    let list = requestsByEmployee.get(key);
    if (!list) {
      list = [];
      requestsByEmployee.set(key, list);
    }
    list.push(req);
  }

  // --- Remaining via balances, with a tenant-wide availability probe ---
  const balancesByEmployee = new Map<string, LeaveBalance[]>();
  let balancesAvailable = false;
  if (employees.length > 0) {
    const [probe, ...rest] = employees;
    const probeResult = await tryBalances(client, probe!.id);
    if (probeResult !== null) {
      balancesAvailable = true;
      balancesByEmployee.set(String(probe!.id), probeResult);
      await mapWithConcurrency(rest, BALANCE_CONCURRENCY, async (emp) => {
        const b = await tryBalances(client, emp.id);
        if (b !== null) balancesByEmployee.set(String(emp.id), b);
      });
    }
  }

  // --- Per-employee rows ---
  // Columns are the union of tenant policies plus any policy seen in usage.
  const seenPolicyIds = new Set<string>(policyMeta.keys());
  const employeeRows: DashboardEmployeeRow[] = employees.map((emp) => {
    const empKey = String(emp.id);
    const reqs = requestsByEmployee.get(empKey) ?? [];
    const { by_policy } = aggregateByPolicy(reqs, dayOpts);
    // Map policy_id → approved days used. "Used" = days actually taken off, so
    // we count approved only (pending/rejected/cancelled are not used).
    const usedByPolicy = new Map<string, { policy_id: string | number | null; used: number }>();
    for (const bucket of by_policy) {
      const pid = String(bucket.policy_id ?? "unknown");
      seenPolicyIds.add(pid);
      usedByPolicy.set(pid, {
        policy_id: bucket.policy_id,
        used: bucket.by_status.approved.days,
      });
    }

    const balances = balancesByEmployee.get(empKey) ?? [];
    const cells: EmployeePolicyCell[] = [];
    for (const pid of seenPolicyIds) {
      const meta = policyMeta.get(pid);
      const usedEntry = usedByPolicy.get(pid);
      const used = usedEntry?.used ?? 0;
      // Only emit a cell when the employee has usage or a known tenant policy;
      // skip synthetic "unknown" columns the employee never touched.
      if (!meta && !usedEntry) continue;
      const policyId = meta?.policy_id ?? usedEntry?.policy_id ?? (pid === "unknown" ? null : pid);
      const policyName = meta?.name ?? policyNameById.get(pid) ?? null;
      const allowance = meta?.allowance ?? null;

      let remaining: number | null = null;
      let source: RemainingSource = "unknown";
      if (balancesAvailable) {
        const fromBalances = pickRemainingFromBalances(balances, policyId, policyName);
        if (fromBalances !== null) {
          remaining = round2(fromBalances);
          source = "balances";
        }
      }
      // Only compute a remaining for policies with a real positive allowance.
      // Sick / unpaid / temporary leave carry allowance 0 in SageHR (no fixed
      // bucket — they show "days used" only), so "allowance − used" would be a
      // meaningless negative; leave remaining null → the UI shows "—".
      if (source === "unknown" && allowance !== null && allowance > 0) {
        remaining = round2(allowance - used);
        source = "computed";
      }

      cells.push({
        policy_id: policyId,
        policy: policyName,
        used: round2(used),
        remaining,
        allowance,
        remaining_source: source,
      });
    }
    cells.sort((a, b) => (a.policy ?? "").localeCompare(b.policy ?? ""));

    const totalUsed = round2(cells.reduce((s, c) => s + c.used, 0));
    const remainingValues = cells.map((c) => c.remaining).filter((n): n is number => n !== null);
    const totalRemaining =
      remainingValues.length > 0 ? round2(remainingValues.reduce((s, n) => s + n, 0)) : null;

    return {
      employee_id: emp.id,
      name: employeeName(emp),
      team_id: emp.team_id ?? null,
      team:
        (typeof emp.team === "string" ? emp.team : null) ??
        (emp.team_id != null ? (teamNameById.get(String(emp.team_id)) ?? null) : null),
      by_policy: cells,
      totals: { used: totalUsed, remaining: totalRemaining },
    };
  });
  employeeRows.sort((a, b) => b.totals.used - a.totals.used);

  // --- Roll-ups ---
  const byPolicy = rollupPolicies(employeeRows.flatMap((r) => r.by_policy));

  const teamGroups = new Map<string, DashboardEmployeeRow[]>();
  for (const row of employeeRows) {
    const key = row.team_id != null ? String(row.team_id) : "none";
    let list = teamGroups.get(key);
    if (!list) {
      list = [];
      teamGroups.set(key, list);
    }
    list.push(row);
  }
  const byTeam: TeamRollup[] = [...teamGroups.entries()]
    .map(([key, rows]) => ({
      team_id: key === "none" ? null : (rows[0]!.team_id ?? key),
      name: rows[0]!.team ?? (key === "none" ? null : (teamNameById.get(key) ?? null)),
      employee_count: rows.length,
      by_policy: rollupPolicies(rows.flatMap((r) => r.by_policy)),
    }))
    .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));

  // Policy column list: tenant policies plus any extra ids seen in usage.
  const policies: DashboardPolicy[] = [];
  for (const pid of seenPolicyIds) {
    const meta = policyMeta.get(pid);
    if (meta) {
      policies.push({
        policy_id: meta.policy_id,
        policy: meta.name,
        unit: meta.unit,
        default_allowance: meta.allowance,
      });
    } else if (pid !== "unknown") {
      policies.push({
        policy_id: pid,
        policy: policyNameById.get(pid) ?? null,
        unit: null,
        default_allowance: null,
      });
    }
  }
  policies.sort((a, b) => (a.policy ?? "").localeCompare(b.policy ?? ""));

  const teams: DashboardTeam[] = teamList.map((t) => ({
    team_id: t.id,
    name: typeof t.name === "string" ? t.name : null,
  }));

  return {
    generated_at: todayISO(),
    range: { from, to },
    day_counting: describeDayCounting(dayOpts),
    balances_available: balancesAvailable,
    policies,
    teams,
    employees: employeeRows,
    by_team: byTeam,
    by_policy: byPolicy,
  };
}

// --- helpers ---

function rollupPolicies(cells: EmployeePolicyCell[]): PolicyRollup[] {
  const map = new Map<string, PolicyRollup & { _hasRemaining: boolean }>();
  for (const c of cells) {
    const key = c.policy_id != null ? String(c.policy_id) : c.policy ?? "unknown";
    let entry = map.get(key);
    if (!entry) {
      entry = {
        policy_id: c.policy_id,
        policy: c.policy,
        used: 0,
        remaining: 0,
        _hasRemaining: false,
      };
      map.set(key, entry);
    }
    entry.used = round2(entry.used + c.used);
    if (c.remaining !== null) {
      entry.remaining = round2((entry.remaining ?? 0) + c.remaining);
      entry._hasRemaining = true;
    }
  }
  return [...map.values()]
    .map(({ _hasRemaining, ...r }) => ({ ...r, remaining: _hasRemaining ? r.remaining : null }))
    .sort((a, b) => b.used - a.used);
}

/**
 * Find a remaining/available figure for one policy from an employee's balance
 * rows. Matches by policy_id first, then by policy name. SageHR's balance
 * shape is unverified, so prefer `available`, fall back to `balance`.
 */
function pickRemainingFromBalances(
  balances: LeaveBalance[],
  policyId: string | number | null,
  policyName: string | null,
): number | null {
  for (const b of balances) {
    const idMatch =
      policyId != null && b.policy_id != null && String(b.policy_id) === String(policyId);
    const nameMatch =
      policyName != null &&
      typeof b.policy === "string" &&
      b.policy.toLowerCase() === policyName.toLowerCase();
    if (idMatch || nameMatch) {
      const raw = b.available ?? b.balance;
      const n = toNumberOrNull(raw);
      if (n !== null) return n;
    }
  }
  return null;
}

/** Returns the balance rows, or null if the endpoint is unavailable (404/throw). */
async function tryBalances(
  client: SageHRClient,
  employeeId: number | string,
): Promise<LeaveBalance[] | null> {
  try {
    return await client.policies.balancesFor(employeeId);
  } catch {
    return null;
  }
}

async function mapWithConcurrency<T>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      await fn(items[index]!, index);
    }
  });
  await Promise.all(workers);
}

function employeeName(emp: Employee): string {
  if (typeof emp.full_name === "string" && emp.full_name.trim()) return emp.full_name.trim();
  const parts = [emp.first_name, emp.last_name].filter(
    (p): p is string => typeof p === "string" && p.length > 0,
  );
  if (parts.length > 0) return parts.join(" ");
  if (typeof emp.email === "string" && emp.email) return emp.email;
  return String(emp.id);
}

function defaultYearEnd(today: Date = new Date()): string {
  return `${today.getUTCFullYear()}-12-31`;
}

function toNumberOrNull(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
