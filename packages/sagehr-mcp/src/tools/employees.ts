import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SageHRClient, Employee } from "@hr-automotion/sagehr-client";
import { withErrorHandling } from "./_helpers.js";

export function registerEmployeeTools(server: McpServer, client: SageHRClient): void {
  server.registerTool(
    "sagehr_list_employees",
    {
      title: "List employees",
      description:
        "Paged list of employees in the SageHR tenant. Filter by team or employment status.",
      inputSchema: {
        team_id: z.union([z.number(), z.string()]).optional(),
        status: z
          .string()
          .optional()
          .describe("Filter by employment status, e.g. 'active' or 'inactive'."),
        page: z.number().int().positive().optional(),
        page_size: z.number().int().positive().max(200).optional(),
      },
    },
    async (args) =>
      withErrorHandling("sagehr_list_employees", async () => {
        return await client.employees.list(args);
      }),
  );

  server.registerTool(
    "sagehr_get_employee",
    {
      title: "Get employee",
      description: "Fetch one employee by id.",
      inputSchema: {
        employee_id: z
          .union([z.number(), z.string()])
          .describe("SageHR employee id, numeric or string."),
      },
    },
    async ({ employee_id }) =>
      withErrorHandling("sagehr_get_employee", async () => {
        return await client.employees.get(employee_id);
      }),
  );

  server.registerTool(
    "sagehr_search_employees",
    {
      title: "Search employees",
      description:
        "Client-side fuzzy search across employees by name or email. Iterates the directory; use sparingly on large tenants.",
      inputSchema: {
        query: z.string().min(1).describe("Substring to match against name and email."),
        limit: z.number().int().positive().max(50).optional().default(10),
      },
    },
    async ({ query, limit }) =>
      withErrorHandling("sagehr_search_employees", async () => {
        const needle = query.toLowerCase();
        const matches: Employee[] = [];
        const cap = limit ?? 10;
        for await (const emp of client.employees.listAll({ page_size: 100 })) {
          const hay = [
            emp.first_name,
            emp.last_name,
            emp.full_name,
            emp.email,
          ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();
          if (hay.includes(needle)) {
            matches.push(emp);
            if (matches.length >= cap) break;
          }
        }
        return { matches, count: matches.length };
      }),
  );
}
