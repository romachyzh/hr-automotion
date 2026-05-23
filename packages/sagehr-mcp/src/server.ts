import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SageHRClient } from "@hr-automotion/sagehr-client";
import type { Config } from "./config.js";
import { registerEmployeeTools } from "./tools/employees.js";
import { registerLeaveTools } from "./tools/leave.js";
import { registerAbsenceTools } from "./tools/absences.js";
import { registerOrgTools } from "./tools/org.js";

export interface BuildServerResult {
  server: McpServer;
  client: SageHRClient;
}

export function buildServer(config: Config): BuildServerResult {
  const client = new SageHRClient({
    subdomain: config.subdomain,
    apiKey: config.apiKey,
    userAgent: config.userAgent,
  });

  const server = new McpServer(
    {
      name: "sagehr-mcp",
      version: "0.1.0",
    },
    {
      capabilities: { tools: {} },
      instructions:
        "Read-only access to a SageHR tenant. Use these tools to look up employees, leave requests, absences, teams, positions, and leave policies. All data comes live from the SageHR REST API.",
    },
  );

  registerEmployeeTools(server, client);
  registerLeaveTools(server, client);
  registerAbsenceTools(server, client);
  registerOrgTools(server, client, config);

  return { server, client };
}
