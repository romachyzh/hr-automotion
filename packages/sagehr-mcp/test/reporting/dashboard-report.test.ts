import { describe, it, expect } from "vitest";
import { buildDashboardReport } from "../../src/reporting/dashboard-report.js";
import type { SageHRClient } from "@hr-automotion/sagehr-client";

// --- fake client builder ---
interface FakeData {
  policies?: Array<Record<string, unknown>>;
  teams?: Array<Record<string, unknown>>;
  employees?: Array<Record<string, unknown>>;
  requests?: Array<Record<string, unknown>>;
  balances?: Record<string, Array<Record<string, unknown>> | "throw">;
}

function fakeClient(data: FakeData): SageHRClient {
  async function* gen<T>(items: T[]): AsyncIterable<T> {
    for (const i of items) yield i;
  }
  const client = {
    policies: {
      list: async () => data.policies ?? [],
      balancesFor: async (id: number | string) => {
        const entry = data.balances?.[String(id)];
        if (entry === "throw" || entry === undefined) {
          throw new Error("404 leave-balances not found");
        }
        return entry;
      },
    },
    teams: {
      list: async () => data.teams ?? [],
    },
    employees: {
      listAll: () => gen(data.employees ?? []),
    },
    leaveRequests: {
      listAll: () => gen(data.requests ?? []),
    },
  };
  return client as unknown as SageHRClient;
}

const POLICY_VACATION = { id: 7, name: "Vacation", unit: "days", default_allowance: 20 };

// Mon 2026-04-20 → Fri 2026-04-24 = 5 business days.
const APPROVED_5_DAYS = {
  id: 100,
  employee_id: 1,
  policy_id: 7,
  status_code: "approved",
  start_date: "2026-04-20",
  end_date: "2026-04-24",
};
// Wed 2026-05-06 = 1 business day.
const APPROVED_1_DAY = {
  id: 101,
  employee_id: 2,
  policy_id: 7,
  status_code: "approved",
  start_date: "2026-05-06",
};

describe("buildDashboardReport", () => {
  it("uses balances for remaining when the endpoint is available", async () => {
    const client = fakeClient({
      policies: [POLICY_VACATION],
      teams: [{ id: 10, name: "Engineering" }],
      employees: [
        { id: 1, full_name: "A. Marin", team_id: 10, team: "Engineering" },
        { id: 2, full_name: "B. Kovač", team_id: 10, team: "Engineering" },
      ],
      requests: [APPROVED_5_DAYS, APPROVED_1_DAY],
      balances: {
        "1": [{ policy_id: 7, available: 12 }],
        "2": [{ policy_id: 7, available: 19 }],
      },
    });

    const report = await buildDashboardReport(client, { from: "2026-01-01", to: "2026-05-31" });

    expect(report.balances_available).toBe(true);
    const marin = report.employees.find((e) => String(e.employee_id) === "1")!;
    const cell = marin.by_policy.find((c) => String(c.policy_id) === "7")!;
    expect(cell.used).toBe(5);
    expect(cell.remaining).toBe(12);
    expect(cell.remaining_source).toBe("balances");
  });

  it("falls back to allowance − used when balances 404", async () => {
    const client = fakeClient({
      policies: [POLICY_VACATION],
      teams: [{ id: 10, name: "Engineering" }],
      employees: [{ id: 1, full_name: "A. Marin", team_id: 10, team: "Engineering" }],
      requests: [APPROVED_5_DAYS],
      balances: { "1": "throw" },
    });

    const report = await buildDashboardReport(client);
    expect(report.balances_available).toBe(false);
    const cell = report.employees[0]!.by_policy.find((c) => String(c.policy_id) === "7")!;
    expect(cell.used).toBe(5);
    expect(cell.remaining).toBe(15); // 20 − 5
    expect(cell.remaining_source).toBe("computed");
  });

  it("returns null remaining when allowance is unknown and balances unavailable", async () => {
    const client = fakeClient({
      policies: [{ id: 7, name: "Vacation", unit: "days", default_allowance: null }],
      teams: [],
      employees: [{ id: 1, full_name: "A. Marin" }],
      requests: [APPROVED_5_DAYS],
      balances: { "1": "throw" },
    });

    const report = await buildDashboardReport(client);
    const cell = report.employees[0]!.by_policy.find((c) => String(c.policy_id) === "7")!;
    expect(cell.remaining).toBeNull();
    expect(cell.remaining_source).toBe("unknown");
  });

  it("shows no remaining for zero-allowance policies (sick/unpaid/temporary)", async () => {
    const client = fakeClient({
      policies: [
        { id: 7, name: "Vacation", unit: "days", default_allowance: 20 },
        { id: 8, name: "Sickday", unit: "days", default_allowance: 0 },
      ],
      teams: [],
      employees: [{ id: 1, full_name: "A. Marin" }],
      requests: [
        APPROVED_5_DAYS, // vacation, policy 7
        { id: 200, employee_id: 1, policy_id: 8, status_code: "approved", start_date: "2026-05-06" },
      ],
      balances: { "1": "throw" },
    });

    const report = await buildDashboardReport(client);
    const row = report.employees[0]!;
    const sick = row.by_policy.find((c) => String(c.policy_id) === "8")!;
    expect(sick.used).toBe(1);
    expect(sick.remaining).toBeNull();
    expect(sick.remaining_source).toBe("unknown");
    // Total remaining counts only the vacation cell (allowance 20 − 5 = 15).
    expect(row.totals.remaining).toBe(15);
  });

  it("filters to a single team when teamId is given", async () => {
    const client = fakeClient({
      policies: [POLICY_VACATION],
      teams: [
        { id: 10, name: "Engineering" },
        { id: 20, name: "Sales" },
      ],
      employees: [
        { id: 1, full_name: "A. Marin", team_id: 10 },
        { id: 2, full_name: "C. Vega", team_id: 20 },
      ],
      requests: [APPROVED_5_DAYS, { ...APPROVED_1_DAY, employee_id: 2 }],
      balances: { "1": "throw" },
    });

    const report = await buildDashboardReport(client, { teamId: 10 });
    expect(report.employees).toHaveLength(1);
    expect(String(report.employees[0]!.employee_id)).toBe("1");
  });

  it("produces by_team and by_policy roll-ups", async () => {
    const client = fakeClient({
      policies: [POLICY_VACATION],
      teams: [{ id: 10, name: "Engineering" }],
      employees: [
        { id: 1, full_name: "A. Marin", team_id: 10, team: "Engineering" },
        { id: 2, full_name: "B. Kovač", team_id: 10, team: "Engineering" },
      ],
      requests: [APPROVED_5_DAYS, APPROVED_1_DAY],
      balances: { "1": "throw" },
    });

    const report = await buildDashboardReport(client);
    expect(report.by_team).toHaveLength(1);
    expect(report.by_team[0]!.employee_count).toBe(2);
    const teamVacation = report.by_team[0]!.by_policy.find((p) => String(p.policy_id) === "7")!;
    expect(teamVacation.used).toBe(6); // 5 + 1
    const policyRollup = report.by_policy.find((p) => String(p.policy_id) === "7")!;
    expect(policyRollup.used).toBe(6);
  });
});
