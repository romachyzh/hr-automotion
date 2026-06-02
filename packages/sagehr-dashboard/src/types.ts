// Hand-written mirror of the JSON returned by GET /api/dashboard
// (packages/sagehr-mcp/src/reporting/dashboard-report.ts). Keep in sync.

export type RemainingSource = "balances" | "computed" | "unknown";

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
  /** `balances` = SageHR's own figure; `computed` = business-day fallback. */
  used_source: RemainingSource;
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

export interface DayCounting {
  basis: "business_days" | "calendar_days";
  weekends_counted: boolean;
  holidays_excluded: number;
}

export interface DashboardReport {
  generated_at: string;
  range: { from: string; to: string };
  day_counting: DayCounting;
  balances_available: boolean;
  policies: DashboardPolicy[];
  teams: DashboardTeam[];
  employees: DashboardEmployeeRow[];
  by_team: TeamRollup[];
  by_policy: PolicyRollup[];
}
