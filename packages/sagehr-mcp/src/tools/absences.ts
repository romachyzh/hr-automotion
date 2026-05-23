/**
 * Out-of-office (absences) tool.
 *
 * Derived, not native: SageHR's /leave-management/out-of-office endpoint
 * returns 404 on the aleph1 tenant (and possibly others). We synthesise
 * the same answer from leave-requests instead:
 *
 *   1. Walk /leave-management/requests in the date range (chunked).
 *   2. Keep status_code === "approved" (fuzzy match on `status` as fallback).
 *   3. If team_id is set, intersect with that team's employee_ids
 *      from /teams.
 *
 * Each output record looks like a leave-request mapped to absence shape:
 *   { id, employee_id, start_date, end_date, policy_id, status, is_part_of_day, hours }
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SageHRClient } from "@hr-automotion/sagehr-client";
import { withErrorHandling } from "./_helpers.js";

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected ISO date YYYY-MM-DD");

export function registerAbsenceTools(server: McpServer, client: SageHRClient): void {
  // Derived from GET /leave-management/requests (chunked, status=approved)
  // + optional join with /teams to filter by team_id.
  //   `from` and `to` are REQUIRED. Any range length is fine — the client
  //   auto-chunks under the hood.
  //
  //   Example tool calls:
  //   { "name": "sagehr_list_absences",
  //     "arguments": { "from": "2026-05-20", "to": "2026-05-27" } }     // who's out this week
  //   { "name": "sagehr_list_absences",
  //     "arguments": { "from": "2026-01-01", "to": "2026-12-31",
  //                    "team_id": 42 } }                                // a team's year
  server.registerTool(
    "sagehr_list_absences",
    {
      title: "List absences (out-of-office)",
      description:
        "Who is out of office in the given date range. Derived from approved leave requests — works on all tenants regardless of whether the native /out-of-office endpoint exists.",
      inputSchema: {
        from: isoDate.describe("Inclusive start of the range (YYYY-MM-DD)."),
        to: isoDate.describe("Inclusive end of the range (YYYY-MM-DD)."),
        team_id: z.union([z.number(), z.string()]).optional(),
      },
    },
    async ({ from, to, team_id }) =>
      withErrorHandling("sagehr_list_absences", async () => {
        const items = await client.absences.list({ from, to, team_id });
        return { from, to, count: items.length, absences: items };
      }),
  );
}
