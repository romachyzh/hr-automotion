/**
 * Employee-directory tools.
 *
 * Wraps these SageHR REST endpoints:
 *   GET /employees                — list
 *   GET /employees/{id}           — single
 *
 * Common response envelope: `{ data: [...], meta: { total?, current_page?, total_pages? } }`.
 * Single-resource calls return `{ data: {...} }` and we unwrap.
 *
 * Discovered limits and quirks:
 *   • Some tenants omit `meta.total` — counts may be `null` in tool output.
 *   • No known date-range / size caps on /employees itself.
 *   • Status filter ("active" / "inactive") is tenant-dependent; safer to omit
 *     if you want everyone.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SageHRClient, Employee } from "@hr-automotion/sagehr-client";
import { withErrorHandling } from "./_helpers.js";

export function registerEmployeeTools(server: McpServer, client: SageHRClient): void {
  // SageHR: GET /employees
  //   Query params we send: page, page_size, team_id, status
  //   Returns: { data: Employee[], meta: { total?, current_page?, total_pages? } }
  //
  //   Example tool call:
  //   { "name": "sagehr_list_employees",
  //     "arguments": { "team_id": 42, "status": "active", "page": 1, "page_size": 50 } }
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
        const result = await client.employees.list(args);
        // SageHR silently ignores `page_size` on /employees and returns the
        // whole page. Truncate client-side so the model gets what it asked for.
        if (args.page_size && result.data.length > args.page_size) {
          return {
            ...result,
            data: result.data.slice(0, args.page_size),
            client_truncated: { original_count: result.data.length, page_size: args.page_size },
          };
        }
        return result;
      }),
  );

  // SageHR: GET /employees/{id}
  //   No query params.
  //   Returns: { data: Employee }  (we unwrap)
  //
  //   Example tool call:
  //   { "name": "sagehr_get_employee", "arguments": { "employee_id": 1 } }
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

  // SageHR: GET /employees (iterated)
  //   No native search endpoint — we walk the full directory and match
  //   client-side against first_name + last_name + full_name + email.
  //   Cost grows linearly with headcount; prefer sagehr_list_employees
  //   with a team_id filter when possible.
  //
  //   Example tool call:
  //   { "name": "sagehr_search_employees", "arguments": { "query": "marin", "limit": 5 } }
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
