import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SageHRClient } from "@hr-automotion/sagehr-client";
import { withErrorHandling } from "./_helpers.js";

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected ISO date YYYY-MM-DD");

export function registerAbsenceTools(server: McpServer, client: SageHRClient): void {
  server.registerTool(
    "sagehr_list_absences",
    {
      title: "List absences (out-of-office)",
      description:
        "Who is out of office in the given date range. Use for staffing / calendar overlap checks.",
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
