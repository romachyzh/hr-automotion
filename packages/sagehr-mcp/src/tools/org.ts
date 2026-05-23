/**
 * Org-structure tools (teams, positions, identity probe).
 *
 * Wraps:
 *   GET /teams       — list teams
 *   GET /positions   — list positions / job titles
 *   GET /employees?page=1&page_size=1  — used by whoami as a connectivity probe
 *
 * None of these accept query params we currently expose. All return a flat
 * `{ data: [...] }` envelope; the meta fields vary by tenant and are passed
 * through opaquely.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SageHRClient } from "@hr-automotion/sagehr-client";
import type { Config } from "../config.js";
import { withErrorHandling } from "./_helpers.js";

export function registerOrgTools(
  server: McpServer,
  client: SageHRClient,
  config: Config,
): void {
  // SageHR: GET /teams
  //   No query params.
  //   Returns: { data: Team[] }
  //
  //   Example tool call:
  //   { "name": "sagehr_list_teams", "arguments": {} }
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

  // SageHR: GET /positions
  //   No query params.
  //   Returns: { data: Position[] }
  //
  //   Example tool call:
  //   { "name": "sagehr_list_positions", "arguments": {} }
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

  // SageHR: GET /employees?page=1&page_size=1  (probe call)
  //   Used as a fast end-to-end health check: confirms subdomain DNS,
  //   API key auth, and base /employees endpoint are all working.
  //   `employees_total` will be `null` on tenants whose meta envelope
  //   doesn't carry a `total` field — that doesn't mean zero employees.
  //
  //   Example tool call:
  //   { "name": "sagehr_whoami", "arguments": {} }
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
