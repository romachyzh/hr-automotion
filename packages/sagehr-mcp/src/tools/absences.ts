/**
 * Out-of-office (absences) tools.
 *
 * Wraps:
 *   GET /leave-management/out-of-office
 *
 * Query params we send: from, to, team_id
 * Returns: { data: Absence[] }  (no pagination meta on this endpoint)
 *
 * Discovered limits and quirks:
 *   • Same 65-day range cap as /leave-management/requests likely applies.
 *     The client auto-chunks into ≤60-day windows and concatenates results.
 *   • Records may carry either {date} (single day) OR {start_date, end_date}
 *     plus is_part_of_day / hours for half-days. The schema is permissive
 *     so all shapes pass through.
 *   • A team_id filter limits to that team's members; without it, the
 *     response covers the whole tenant.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SageHRClient } from "@hr-automotion/sagehr-client";
import { withErrorHandling } from "./_helpers.js";

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected ISO date YYYY-MM-DD");

export function registerAbsenceTools(server: McpServer, client: SageHRClient): void {
  // SageHR: GET /leave-management/out-of-office?from=…&to=…[&team_id=…]
  //   `from` and `to` are REQUIRED. Long ranges are auto-chunked into
  //   ≤60-day windows by the client; the model can request any range.
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
        "Who is out of office in the given date range. Use for staffing / calendar overlap checks. " +
        "Long ranges are auto-chunked into <=60-day windows in the client.",
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
