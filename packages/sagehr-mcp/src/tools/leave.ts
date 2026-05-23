import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SageHRClient } from "@hr-automotion/sagehr-client";
import { withErrorHandling } from "./_helpers.js";

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected ISO date YYYY-MM-DD");

export function registerLeaveTools(server: McpServer, client: SageHRClient): void {
  server.registerTool(
    "sagehr_list_leave_requests",
    {
      title: "List leave requests",
      description: "Paged list of leave requests, with optional date range and status filters.",
      inputSchema: {
        employee_id: z.union([z.number(), z.string()]).optional(),
        from: isoDate.optional().describe("Start of date range, inclusive."),
        to: isoDate.optional().describe("End of date range, inclusive."),
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
