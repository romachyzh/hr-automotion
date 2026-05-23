import { describe, it, expect, vi } from "vitest";
import {
  SageHRClient,
  SageHRAuthError,
  SageHRNotFoundError,
  SageHRRateLimitError,
  SageHRError,
} from "../src/index.js";
import { chunkDateRange } from "../src/pagination.js";

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

function mockFetch(responses: Array<Response | (() => Response)>) {
  const fn = vi.fn(async () => {
    const next = responses.shift();
    if (!next) throw new Error("mockFetch: no more responses queued");
    return typeof next === "function" ? next() : next;
  });
  return fn as unknown as typeof fetch;
}

describe("SageHRClient", () => {
  it("builds the correct base URL and X-Auth-Token header", async () => {
    const fetch = vi.fn(async () =>
      jsonResponse({ data: [], meta: { total: 0, current_page: 1, total_pages: 0 } }),
    );
    const client = new SageHRClient({
      subdomain: "acme",
      apiKey: "secret",
      fetch: fetch as unknown as typeof globalThis.fetch,
      maxRetries: 0,
    });

    await client.employees.list({ page: 1, page_size: 50 });

    expect(fetch).toHaveBeenCalledOnce();
    const [url, init] = fetch.mock.calls[0]!;
    expect(String(url)).toContain("https://acme.sage.hr/api/employees");
    expect(String(url)).toContain("page=1");
    expect(String(url)).toContain("page_size=50");
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers["X-Auth-Token"]).toBe("secret");
    expect(headers["Accept"]).toBe("application/json");
  });

  it("throws SageHRAuthError on 401 without retry", async () => {
    const fetch = mockFetch([
      new Response("unauthorized", { status: 401 }),
    ]);
    const client = new SageHRClient({
      subdomain: "acme",
      apiKey: "bad",
      fetch,
      maxRetries: 3,
    });
    await expect(client.employees.list()).rejects.toBeInstanceOf(SageHRAuthError);
  });

  it("throws SageHRNotFoundError on 404 for a single resource fetch", async () => {
    const fetch = mockFetch([new Response("nope", { status: 404 })]);
    const client = new SageHRClient({
      subdomain: "acme",
      apiKey: "k",
      fetch,
      maxRetries: 0,
    });
    await expect(client.employees.get(999)).rejects.toBeInstanceOf(SageHRNotFoundError);
  });

  it("retries on 429 then succeeds", async () => {
    const fetch = mockFetch([
      new Response("rate limited", { status: 429, headers: { "retry-after": "0" } }),
      jsonResponse({ data: [], meta: { total: 0, current_page: 1, total_pages: 0 } }),
    ]);
    const client = new SageHRClient({
      subdomain: "acme",
      apiKey: "k",
      fetch,
      maxRetries: 2,
    });
    const res = await client.employees.list();
    expect(res.data).toEqual([]);
  });

  it("throws SageHRRateLimitError when retries are exhausted on 429", async () => {
    const fetch = mockFetch([
      new Response("r", { status: 429, headers: { "retry-after": "0" } }),
      new Response("r", { status: 429, headers: { "retry-after": "0" } }),
    ]);
    const client = new SageHRClient({
      subdomain: "acme",
      apiKey: "k",
      fetch,
      maxRetries: 1,
    });
    await expect(client.employees.list()).rejects.toBeInstanceOf(SageHRRateLimitError);
  });

  it("retries on 500 then surfaces SageHRError after exhaustion", async () => {
    const fetch = mockFetch([
      new Response("boom", { status: 500 }),
      new Response("boom", { status: 500 }),
    ]);
    const client = new SageHRClient({
      subdomain: "acme",
      apiKey: "k",
      fetch,
      maxRetries: 1,
    });
    await expect(client.employees.list()).rejects.toBeInstanceOf(SageHRError);
  });

  it("parses an employee list happy path", async () => {
    const fetch = mockFetch([
      jsonResponse({
        data: [
          { id: 1, email: "a@x.com", first_name: "Ada", last_name: "L" },
          { id: 2, email: "b@x.com", first_name: "Bo", last_name: "M" },
        ],
        meta: { total: 2, current_page: 1, total_pages: 1 },
      }),
    ]);
    const client = new SageHRClient({
      subdomain: "acme",
      apiKey: "k",
      fetch,
      maxRetries: 0,
    });
    const res = await client.employees.list();
    expect(res.data).toHaveLength(2);
    expect(res.data[0]!.email).toBe("a@x.com");
  });

  it("paginates listAll across pages", async () => {
    const fetch = mockFetch([
      jsonResponse({
        data: [{ id: 1 }, { id: 2 }],
        meta: { total: 3, current_page: 1, total_pages: 2 },
      }),
      jsonResponse({
        data: [{ id: 3 }],
        meta: { total: 3, current_page: 2, total_pages: 2 },
      }),
    ]);
    const client = new SageHRClient({
      subdomain: "acme",
      apiKey: "k",
      fetch,
      maxRetries: 0,
    });
    const ids: Array<number | string> = [];
    for await (const emp of client.employees.listAll({ page_size: 2 })) {
      ids.push(emp.id);
    }
    expect(ids).toEqual([1, 2, 3]);
  });

  it("rejects empty subdomain / apiKey", () => {
    expect(() => new SageHRClient({ subdomain: "", apiKey: "k" })).toThrow();
    expect(() => new SageHRClient({ subdomain: "acme", apiKey: "" })).toThrow();
  });

  it("chunks leave-request listAll into <=60-day windows to avoid SageHR 422", async () => {
    const calls: Array<{ from?: string; to?: string }> = [];
    const fetch = vi.fn(async (url: string) => {
      const u = new URL(url);
      calls.push({
        from: u.searchParams.get("from") ?? undefined,
        to: u.searchParams.get("to") ?? undefined,
      });
      return jsonResponse({
        data: [],
        meta: { total: 0, current_page: 1, total_pages: 0 },
      });
    }) as unknown as typeof fetch;
    const client = new SageHRClient({
      subdomain: "acme",
      apiKey: "k",
      fetch,
      maxRetries: 0,
    });

    const out: unknown[] = [];
    for await (const r of client.leaveRequests.listAll({
      from: "2026-01-01",
      to: "2026-05-23", // ~143 days
    })) {
      out.push(r);
    }
    // Expect at least 3 windows (143 / 60 ≈ 3), each ≤ 60 days span.
    expect(calls.length).toBeGreaterThanOrEqual(3);
    for (const c of calls) {
      expect(c.from).toBeDefined();
      expect(c.to).toBeDefined();
      const span = (Date.parse(c.to + "T00:00:00Z") - Date.parse(c.from + "T00:00:00Z")) / 86_400_000;
      expect(span).toBeLessThan(65);
    }
  });
});

describe("chunkDateRange", () => {
  it("returns single window when range is short", () => {
    expect(chunkDateRange("2026-01-01", "2026-02-01", 60)).toEqual([
      { from: "2026-01-01", to: "2026-02-01" },
    ]);
  });
  it("returns the input verbatim when either bound is missing", () => {
    expect(chunkDateRange(undefined, undefined, 60)).toEqual([{ from: undefined, to: undefined }]);
    expect(chunkDateRange("2026-01-01", undefined, 60)).toEqual([
      { from: "2026-01-01", to: undefined },
    ]);
  });
  it("splits >60-day ranges into adjacent windows that fully cover the range", () => {
    const windows = chunkDateRange("2026-01-01", "2026-05-23", 60);
    expect(windows.length).toBeGreaterThan(1);
    expect(windows[0]!.from).toBe("2026-01-01");
    expect(windows[windows.length - 1]!.to).toBe("2026-05-23");
    // adjacent windows are contiguous (next.from = prev.to + 1 day)
    for (let i = 1; i < windows.length; i++) {
      const prevTo = Date.parse(windows[i - 1]!.to! + "T00:00:00Z");
      const nextFrom = Date.parse(windows[i]!.from! + "T00:00:00Z");
      expect(nextFrom - prevTo).toBe(86_400_000);
    }
  });
});
