import { describe, it, expect, vi } from "vitest";
import {
  SageHRClient,
  SageHRAuthError,
  SageHRNotFoundError,
  SageHRRateLimitError,
  SageHRError,
} from "../src/index.js";

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
});
