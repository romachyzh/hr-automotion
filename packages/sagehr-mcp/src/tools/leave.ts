/**
 * Leave-management tools.
 *
 * Wraps these SageHR REST endpoints:
 *   GET /leave-management/requests           — list (paged)
 *   GET /leave-management/requests/{id}      — single
 *   GET /leave-management/policies           — list policies
 *   GET /employees/{id}/leave-balances       — per-employee balances
 *
 * Discovered limits and quirks:
 *   • `/leave-management/requests` rejects any `from`..`to` range of
 *     ≥ 65 days with HTTP 422 (`{"error_code":"bad_parameters",
 *     "errors":["Days between date range must be less than 65"]}`).
 *     For the list tool we let the model pick a tight window; for the
 *     summary tools (leave-summary.ts) the client auto-chunks into
 *     ≤60-day windows transparently.
 *   • The `status` filter values vary by tenant ("approved" / "Approved"
 *     / "awaiting_approval" / "declined"). Tools that aggregate normalise
 *     these via fuzzy match; the raw list tool passes through unchanged.
 *   • Single-resource calls return `{ data: {...} }` envelope (unwrapped).
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SageHRClient } from "@hr-automotion/sagehr-client";
import { withErrorHandling } from "./_helpers.js";

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected ISO date YYYY-MM-DD");

export function registerLeaveTools(server: McpServer, client: SageHRClient): void {
  // SageHR: GET /leave-management/requests
  //   Query params we send: page, page_size, employee_id, from, to, status
  //   Returns: { data: LeaveRequest[], meta: {...} }
  //
  //   ⚠ Constraint: when BOTH `from` and `to` are supplied, the inclusive
  //   span must be < 65 days, otherwise SageHR returns 422
  //   `bad_parameters / "Days between date range must be less than 65"`.
  //   For a year-to-date or longer report, prefer
  //   `sagehr_leave_summary_for_employee` / `_across_employees`, which
  //   auto-chunk in the client.
  //
  //   Example tool call (one month, one employee, approved only):
  //   { "name": "sagehr_list_leave_requests",
  //     "arguments": { "employee_id": 1, "from": "2026-05-01", "to": "2026-05-31",
  //                    "status": "approved", "page": 1, "page_size": 100 } }
  server.registerTool(
    "sagehr_list_leave_requests",
    {
      title: "List leave requests",
      description:
        "Paged list of leave requests, with optional date range and status filters. " +
        "Date range (from..to) must span < 65 days; for longer windows use sagehr_leave_summary_*.",
      inputSchema: {
        employee_id: z.union([z.number(), z.string()]).optional(),
        from: isoDate.optional().describe("Start of date range, inclusive. Must be < 65 days from `to`."),
        to: isoDate.optional().describe("End of date range, inclusive. Must be < 65 days from `from`."),
        status: z.string().optional().describe("e.g. 'approved', 'pending', 'rejected'"),
        page: z.number().int().positive().optional(),
        page_size: z.number().int().positive().max(200).optional(),
      },
    },
    async (args) =>
      withErrorHandling("sagehr_list_leave_requests", async () => {
        return await client.leaveRequests.list(args);
      }),
  );

  // SageHR: GET /leave-management/requests/{id}
  //   No query params.
  //   Returns: { data: LeaveRequest }  (we unwrap)
  //
  //   Example tool call:
  //   { "name": "sagehr_get_leave_request", "arguments": { "leave_request_id": 12345 } }
  server.registerTool(
    "sagehr_get_leave_request",
    {
      title: "Get leave request",
      description: "Fetch a single leave request by id.",
      inputSchema: {
        leave_request_id: z.union([z.number(), z.string()]),
      },
    },
    async ({ leave_request_id }) =>
      withErrorHandling("sagehr_get_leave_request", async () => {
        return await client.leaveRequests.get(leave_request_id);
      }),
  );

  // SageHR: GET /leave-management/policies
  //          GET /employees/{id}/leave-balances  (when employee_id given)
  //   No query params on either.
  //   Returns: { policies: [...], balances?: [...] } (combined client-side)
  //
  //   Example tool calls:
  //   { "name": "sagehr_list_leave_policies", "arguments": {} }
  //   { "name": "sagehr_list_leave_policies", "arguments": { "employee_id": 1 } }
  server.registerTool(
    "sagehr_list_leave_policies",
    {
      title: "List leave policies (and optionally balances)",
      description:
        "Lists all leave policies in the tenant. If `employee_id` is provided, also returns that employee's current balances.",
      inputSchema: {
        employee_id: z
          .union([z.number(), z.string()])
          .optional()
          .describe("Employee id to fetch leave balances for."),
      },
    },
    async ({ employee_id }) =>
      withErrorHandling("sagehr_list_leave_policies", async () => {
        const policies = await client.policies.list();
        if (employee_id === undefined) return { policies };
        const balances = await client.policies.balancesFor(employee_id);
        return { policies, balances };
      }),
  );
}
