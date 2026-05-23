import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SageHRClient } from "@hr-automotion/sagehr-client";
import type { Config } from "../config.js";
import { withErrorHandling } from "./_helpers.js";

export function registerOrgTools(
  server: McpServer,
  client: SageHRClient,
  config: Config,
): void {
  server.registerTool(
    "sagehr_list_teams",
    {
      title: "List teams",
      description: "All teams in the SageHR tenant.",
      inputSchema: {},
    },
    async () =>
      withErrorHandling("sagehr_list_teams", async () => {
        return { teams: await client.teams.list() };
      }),
  );

  server.registerTool(
    "sagehr_list_positions",
    {
      title: "List positions",
      description: "All positions / job titles in the SageHR tenant.",
      inputSchema: {},
    },
    async () =>
      withErrorHandling("sagehr_list_positions", async () => {
        return { positions: await client.positions.list() };
      }),
  );

  server.registerTool(
    "sagehr_whoami",
    {
      title: "Identify the connected tenant",
      description:
        "Returns the configured SageHR subdomain and verifies API connectivity by listing one employee.",
      inputSchema: {},
    },
    async () =>
      withErrorHandling("sagehr_whoami", async () => {
        const probe = await client.employees.list({ page: 1, page_size: 1 });
        return {
          subdomain: config.subdomain,
          base_url: client.baseUrl,
          api_reachable: true,
          employees_total: probe.meta?.total ?? null,
        };
      }),
  );
}
