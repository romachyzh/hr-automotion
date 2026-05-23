/**
 * Aggregation tools for day-off counts.
 *
 * Both tools fan out to `GET /leave-management/requests` repeatedly via the
 * client's `listAll`, which auto-chunks the date range into ≤60-day windows
 * to bypass SageHR's 65-day cap. The model can request a full year (or
 * longer) without worrying about the underlying API limit.
 *
 * Aggregation produces:
 *   • totals  — grand totals across all matching requests
 *   • by_policy — bucketed by leave policy, sorted by days_total desc
 *   • by_status (nested in each policy) — approved / pending / rejected /
 *     cancelled / other, fuzzy-matched from whatever status string the
 *     tenant uses
 *
 * `sagehr_leave_summary_for_employee` additionally fetches
 *   GET /employees/{id}/leave-balances
 * when `include_balances` is true (default).
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SageHRClient, LeaveRequest } from "@hr-automotion/sagehr-client";
import { withErrorHandling } from "./_helpers.js";

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected ISO date YYYY-MM-DD");

/** Bucket key normalising whatever status strings the tenant uses. */
function normaliseStatus(raw: string | null | undefined): "approved" | "pending" | "rejected" | "cancelled" | "other" {
  const s = (raw ?? "").toLowerCase();
  if (s.includes("approve")) return "approved";
  if (s.includes("pend") || s.includes("await")) return "pending";
  if (s.includes("reject") || s.includes("declin")) return "rejected";
  if (s.includes("cancel")) return "cancelled";
  return "other";
}

interface PolicyBucket {
  policy: string | null;
  policy_id: string | number | null;
  request_count: number;
  days_total: number;
  hours_total: number;
  by_status: Record<"approved" | "pending" | "rejected" | "cancelled" | "other", { request_count: number; days: number; hours: number }>;
}

function emptyStatusBuckets(): PolicyBucket["by_status"] {
  return {
    approved: { request_count: 0, days: 0, hours: 0 },
    pending: { request_count: 0, days: 0, hours: 0 },
    rejected: { request_count: 0, days: 0, hours: 0 },
    cancelled: { request_count: 0, days: 0, hours: 0 },
    other: { request_count: 0, days: 0, hours: 0 },
  };
}

/** Aggregate a list of leave requests into a policy-level breakdown. */
function aggregateByPolicy(requests: LeaveRequest[]): {
  by_policy: PolicyBucket[];
  totals: { request_count: number; days_total: number; hours_total: number };
} {
  const buckets = new Map<string, PolicyBucket>();
  let totalDays = 0;
  let totalHours = 0;

  for (const req of requests) {
    const key = `${req.policy_id ?? ""}::${req.policy ?? ""}`;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = {
        policy: req.policy ?? null,
        policy_id: req.policy_id ?? null,
        request_count: 0,
        days_total: 0,
        hours_total: 0,
        by_status: emptyStatusBuckets(),
      };
      buckets.set(key, bucket);
    }
    const days = Number(req.days_count ?? 0) || 0;
    const hours = Number(req.hours_count ?? 0) || 0;
    bucket.request_count += 1;
    bucket.days_total += days;
    bucket.hours_total += hours;
    totalDays += days;
    totalHours += hours;

    const statusKey = normaliseStatus(req.status);
    const statusBucket = bucket.by_status[statusKey];
    statusBucket.request_count += 1;
    statusBucket.days += days;
    statusBucket.hours += hours;
  }

  const by_policy = [...buckets.values()].sort((a, b) => b.days_total - a.days_total);
  return {
    by_policy,
    totals: {
      request_count: requests.length,
      days_total: round2(totalDays),
      hours_total: round2(totalHours),
    },
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function defaultYearStart(today: Date = new Date()): string {
  return `${today.getUTCFullYear()}-01-01`;
}

function todayISO(today: Date = new Date()): string {
  const y = today.getUTCFullYear();
  const m = String(today.getUTCMonth() + 1).padStart(2, "0");
  const d = String(today.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function registerLeaveSummaryTools(server: McpServer, client: SageHRClient): void {
  // SageHR: GET /leave-management/requests (chunked) +
  //         GET /employees/{id}/leave-balances (optional)
  //   No raw query-param exposure — model passes high-level filters and the
  //   tool handles pagination + date chunking + aggregation.
  //
  //   Example tool calls:
  //   { "name": "sagehr_leave_summary_for_employee",
  //     "arguments": { "employee_id": 1 } }                    // YTD, with balances
  //   { "name": "sagehr_leave_summary_for_employee",
  //     "arguments": { "employee_id": 1, "from": "2025-01-01",
  //                    "to": "2025-12-31", "include_balances": false } }
  server.registerTool(
    "sagehr_leave_summary_for_employee",
    {
      title: "Leave summary for one employee",
      description:
        "Per-policy breakdown of day-off counts for one employee (sick leave, vacation, etc.). Defaults to year-to-date. Returns days_total and hours_total per policy, plus status buckets (approved/pending/rejected/cancelled). Also returns current leave balances when available.",
      inputSchema: {
        employee_id: z.union([z.number(), z.string()]),
        from: isoDate.optional().describe("Inclusive start of the range. Defaults to Jan 1 of the current year."),
        to: isoDate.optional().describe("Inclusive end of the range. Defaults to today."),
        include_balances: z
          .boolean()
          .optional()
          .default(true)
          .describe("Also fetch current leave balances for this employee."),
      },
    },
    async ({ employee_id, from, to, include_balances }) =>
      withErrorHandling("sagehr_leave_summary_for_employee", async () => {
        const fromDate = from ?? defaultYearStart();
        const toDate = to ?? todayISO();
        const requests: LeaveRequest[] = [];
        for await (const r of client.leaveRequests.listAll({
          employee_id,
          from: fromDate,
          to: toDate,
        })) {
          requests.push(r);
        }
        const { by_policy, totals } = aggregateByPolicy(requests);
        const balances =
          include_balances !== false
            ? await client.policies.balancesFor(employee_id).catch(() => null)
            : null;
        return {
          employee_id,
          from: fromDate,
          to: toDate,
          totals,
          by_policy,
          balances,
        };
      }),
  );

  // SageHR: GET /leave-management/requests (chunked, tenant-wide)
  //   Walks every request in the date range, then groups by employee_id.
  //   `policy_id` filter is applied client-side (saves a round-trip when
  //   SageHR's own filter doesn't support multi-policy queries).
  //
  //   Example tool calls:
  //   { "name": "sagehr_leave_summary_across_employees", "arguments": {} } // YTD all
  //   { "name": "sagehr_leave_summary_across_employees",
  //     "arguments": { "from": "2026-01-01", "to": "2026-05-23",
  //                    "policy_id": 72221, "status": "approved", "top_n": 10 } }
  server.registerTool(
    "sagehr_leave_summary_across_employees",
    {
      title: "Leave summary across all employees",
      description:
        "Aggregates leave requests across the tenant in a date range and returns per-employee totals plus a per-policy breakdown. Useful for ranking who has used the most sick leave / vacation, or team-wide capacity reporting. Defaults to year-to-date.",
      inputSchema: {
        from: isoDate.optional().describe("Inclusive start. Defaults to Jan 1 of the current year."),
        to: isoDate.optional().describe("Inclusive end. Defaults to today."),
        policy_id: z
          .union([z.number(), z.string()])
          .optional()
          .describe("Restrict to a single policy (e.g. only sick leave)."),
        status: z
          .string()
          .optional()
          .describe("Restrict to one status, e.g. 'approved'. Defaults to all statuses."),
        top_n: z
          .number()
          .int()
          .positive()
          .max(500)
          .optional()
          .default(50)
          .describe("Cap the per-employee list to the top N by days_total."),
      },
    },
    async ({ from, to, policy_id, status, top_n }) =>
      withErrorHandling("sagehr_leave_summary_across_employees", async () => {
        const fromDate = from ?? defaultYearStart();
        const toDate = to ?? todayISO();
        const requests: LeaveRequest[] = [];
        for await (const r of client.leaveRequests.listAll({
          from: fromDate,
          to: toDate,
          status,
        })) {
          if (policy_id !== undefined && String(r.policy_id) !== String(policy_id)) continue;
          requests.push(r);
        }

        // Group requests by employee, then aggregate per policy within each.
        const byEmployee = new Map<string, LeaveRequest[]>();
        for (const r of requests) {
          const key = String(r.employee_id);
          let list = byEmployee.get(key);
          if (!list) {
            list = [];
            byEmployee.set(key, list);
          }
          list.push(r);
        }

        const perEmployee = [...byEmployee.entries()]
          .map(([employee_id, reqs]) => {
            const agg = aggregateByPolicy(reqs);
            return {
              employee_id,
              request_count: agg.totals.request_count,
              days_total: agg.totals.days_total,
              hours_total: agg.totals.hours_total,
              by_policy: agg.by_policy,
            };
          })
          .sort((a, b) => b.days_total - a.days_total);

        const cap = top_n ?? 50;
        const capped = perEmployee.slice(0, cap);
        const grand = aggregateByPolicy(requests);

        return {
          from: fromDate,
          to: toDate,
          filter: { policy_id: policy_id ?? null, status: status ?? null },
          totals: grand.totals,
          by_policy: grand.by_policy,
          employees: capped,
          employees_total: perEmployee.length,
          employees_truncated: perEmployee.length > capped.length,
        };
      }),
  );
}
