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
import type { SageHRClient, LeaveRequest, LeaveDaysOptions } from "@hr-automotion/sagehr-client";
import { withErrorHandling } from "./_helpers.js";
import {
  aggregateByPolicy,
  attachPolicyNames,
  defaultYearStart,
  describeDayCounting,
  fetchPolicyNameMap,
  todayISO,
  withPolicyName,
} from "../reporting/leave-aggregation.js";

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected ISO date YYYY-MM-DD");

/**
 * Shared working-day controls. Days are counted as business days (Mon–Fri,
 * weekends excluded) by default — matching SageHR's working-day total for a
 * standard week. These let the caller match other policy configurations.
 */
const countWeekendsInput = z
  .boolean()
  .optional()
  .default(false)
  .describe(
    "Count Saturdays and Sundays as leave days. Leave false for working-day totals; set true only for policies configured to count weekends as workdays.",
  );

const holidaysInput = z
  .array(isoDate)
  .optional()
  .describe(
    "Public-holiday dates (YYYY-MM-DD) to exclude from the count when they fall on a working day. SageHR's API does not expose its holiday calendar, so supply it here to match SageHR's figure exactly.",
  );

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
        count_weekends: countWeekendsInput,
        holidays: holidaysInput,
      },
    },
    async ({ employee_id, from, to, include_balances, count_weekends, holidays }) =>
      withErrorHandling("sagehr_leave_summary_for_employee", async () => {
        const fromDate = from ?? defaultYearStart();
        const toDate = to ?? todayISO();
        const dayOpts: LeaveDaysOptions = { countWeekends: count_weekends ?? false, holidays };
        const requests: LeaveRequest[] = [];
        for await (const r of client.leaveRequests.listAll({
          employee_id,
          from: fromDate,
          to: toDate,
        })) {
          requests.push(r);
        }
        const { by_policy, totals } = aggregateByPolicy(requests, dayOpts);
        const enriched = await attachPolicyNames(client, by_policy);
        const balances =
          include_balances !== false
            ? await client.policies.balancesFor(employee_id).catch(() => null)
            : null;
        return {
          employee_id,
          from: fromDate,
          to: toDate,
          day_counting: describeDayCounting(dayOpts),
          totals,
          by_policy: enriched,
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
        count_weekends: countWeekendsInput,
        holidays: holidaysInput,
      },
    },
    async ({ from, to, policy_id, status, top_n, count_weekends, holidays }) =>
      withErrorHandling("sagehr_leave_summary_across_employees", async () => {
        const fromDate = from ?? defaultYearStart();
        const toDate = to ?? todayISO();
        const dayOpts: LeaveDaysOptions = { countWeekends: count_weekends ?? false, holidays };
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
            const agg = aggregateByPolicy(reqs, dayOpts);
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
        const grand = aggregateByPolicy(requests, dayOpts);

        // Look up policy names once and attach to every bucket.
        const policyNameById = await fetchPolicyNameMap(client);
        const grandEnriched = grand.by_policy.map((b) => withPolicyName(b, policyNameById));
        const cappedEnriched = capped.map((row) => ({
          ...row,
          by_policy: row.by_policy.map((b) => withPolicyName(b, policyNameById)),
        }));

        return {
          from: fromDate,
          to: toDate,
          day_counting: describeDayCounting(dayOpts),
          filter: { policy_id: policy_id ?? null, status: status ?? null },
          totals: grand.totals,
          by_policy: grandEnriched,
          employees: cappedEnriched,
          employees_total: perEmployee.length,
          employees_truncated: perEmployee.length > capped.length,
        };
      }),
  );
}
