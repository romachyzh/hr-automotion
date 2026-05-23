import { describe, it, expect } from "vitest";
import { buildServer } from "../src/server.js";
import { loadConfig } from "../src/config.js";

describe("buildServer", () => {
  const config = loadConfig({
    SAGEHR_SUBDOMAIN: "acme-test",
    SAGEHR_API_KEY: "fake-key",
  } as NodeJS.ProcessEnv);

  it("constructs an McpServer and a SageHRClient pointed at the right tenant", () => {
    const { server, client } = buildServer(config);
    expect(server).toBeDefined();
    expect(client.baseUrl).toBe("https://acme-test.sage.hr/api");
  });

  it("registers all read-only tools", () => {
    const { server } = buildServer(config);
    // McpServer exposes registered tools internally; reach in via the
    // standard registry shape used by @modelcontextprotocol/sdk v1.
    const registered = (server as unknown as { _registeredTools: Record<string, unknown> })
      ._registeredTools;
    const names = Object.keys(registered).sort();
    expect(names).toEqual(
      [
        "sagehr_get_employee",
        "sagehr_get_leave_request",
        "sagehr_leave_summary_across_employees",
        "sagehr_leave_summary_for_employee",
        "sagehr_list_absences",
        "sagehr_list_employees",
        "sagehr_list_leave_policies",
        "sagehr_list_leave_requests",
        "sagehr_list_positions",
        "sagehr_list_teams",
        "sagehr_search_employees",
        "sagehr_whoami",
      ].sort(),
    );
  });
});

describe("loadConfig", () => {
  it("rejects missing SAGEHR_SUBDOMAIN", () => {
    expect(() =>
      loadConfig({ SAGEHR_API_KEY: "k" } as NodeJS.ProcessEnv),
    ).toThrow(/SAGEHR_SUBDOMAIN/);
  });
  it("rejects missing SAGEHR_API_KEY", () => {
    expect(() =>
      loadConfig({ SAGEHR_SUBDOMAIN: "a" } as NodeJS.ProcessEnv),
    ).toThrow(/SAGEHR_API_KEY/);
  });
  it("parses optional vars", () => {
    const c = loadConfig({
      SAGEHR_SUBDOMAIN: "a",
      SAGEHR_API_KEY: "k",
      LOG_LEVEL: "debug",
      HTTP_PORT: "9999",
      MCP_BEARER_TOKEN: "tok",
    } as NodeJS.ProcessEnv);
    expect(c.logLevel).toBe("debug");
    expect(c.httpPort).toBe(9999);
    expect(c.bearerToken).toBe("tok");
  });

  it("prefers PORT (PaaS convention) over HTTP_PORT", () => {
    const c = loadConfig({
      SAGEHR_SUBDOMAIN: "a",
      SAGEHR_API_KEY: "k",
      PORT: "4321",
      HTTP_PORT: "9999",
    } as NodeJS.ProcessEnv);
    expect(c.httpPort).toBe(4321);
  });

  it("rejects unparseable PORT", () => {
    expect(() =>
      loadConfig({
        SAGEHR_SUBDOMAIN: "a",
        SAGEHR_API_KEY: "k",
        PORT: "not-a-number",
      } as NodeJS.ProcessEnv),
    ).toThrow(/PORT/);
  });
});
