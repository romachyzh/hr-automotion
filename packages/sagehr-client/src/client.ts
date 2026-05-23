import {
  SageHRAuthError,
  SageHRError,
  SageHRNotFoundError,
  SageHRRateLimitError,
} from "./errors.js";
import { EmployeesResource } from "./resources/employees.js";
import { LeaveRequestsResource } from "./resources/leave-requests.js";
import { AbsencesResource } from "./resources/absences.js";
import { TeamsResource } from "./resources/teams.js";
import { PositionsResource } from "./resources/positions.js";
import { PoliciesResource } from "./resources/policies.js";

export interface SageHRClientOptions {
  subdomain: string;
  apiKey: string;
  /** Override fetch (for testing). Defaults to globalThis.fetch. */
  fetch?: typeof fetch;
  userAgent?: string;
  /** Total request timeout in ms. Default 30_000. */
  timeoutMs?: number;
  /** Max retries on 429/5xx. Default 3. */
  maxRetries?: number;
}

export interface RequestOptions {
  method?: "GET";
  query?: Record<string, string | number | boolean | undefined | null>;
  signal?: AbortSignal;
}

const DEFAULT_USER_AGENT = "hr-automotion/sagehr-client/0.1";

export class SageHRClient {
  readonly baseUrl: string;
  readonly employees: EmployeesResource;
  readonly leaveRequests: LeaveRequestsResource;
  readonly absences: AbsencesResource;
  readonly teams: TeamsResource;
  readonly positions: PositionsResource;
  readonly policies: PoliciesResource;

  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;
  private readonly userAgent: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;

  constructor(opts: SageHRClientOptions) {
    if (!opts.subdomain) throw new Error("SageHRClient: subdomain is required");
    if (!opts.apiKey) throw new Error("SageHRClient: apiKey is required");
    this.baseUrl = `https://${opts.subdomain}.sage.hr/api`;
    this.apiKey = opts.apiKey;
    this.fetchImpl = opts.fetch ?? globalThis.fetch.bind(globalThis);
    this.userAgent = opts.userAgent ?? DEFAULT_USER_AGENT;
    this.timeoutMs = opts.timeoutMs ?? 30_000;
    this.maxRetries = opts.maxRetries ?? 3;

    this.employees = new EmployeesResource(this);
    this.leaveRequests = new LeaveRequestsResource(this);
    this.absences = new AbsencesResource(this);
    this.teams = new TeamsResource(this);
    this.positions = new PositionsResource(this);
    this.policies = new PoliciesResource(this);
  }

  /** Internal: send a request and parse JSON. Resources call this. */
  async request<T = unknown>(path: string, opts: RequestOptions = {}): Promise<T> {
    const url = this.buildUrl(path, opts.query);
    let attempt = 0;
    let lastErr: unknown;

    while (attempt <= this.maxRetries) {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), this.timeoutMs);
      // Forward upstream abort.
      const onUpstreamAbort = () => ac.abort();
      opts.signal?.addEventListener("abort", onUpstreamAbort, { once: true });

      try {
        const res = await this.fetchImpl(url, {
          method: opts.method ?? "GET",
          headers: {
            "X-Auth-Token": this.apiKey,
            Accept: "application/json",
            "User-Agent": this.userAgent,
          },
          signal: ac.signal,
        });

        if (res.ok) {
          if (res.status === 204) return undefined as T;
          return (await res.json()) as T;
        }

        const bodyText = await res.text();
        const body = safeParseJson(bodyText);

        if (res.status === 401) {
          throw new SageHRAuthError({ body, endpoint: path });
        }
        if (res.status === 404) {
          throw new SageHRNotFoundError({ body, endpoint: path });
        }
        if (res.status === 429) {
          const retryAfter = parseRetryAfter(res.headers.get("retry-after"));
          if (attempt < this.maxRetries) {
            await sleep(backoffMs(attempt, retryAfter));
            attempt++;
            continue;
          }
          throw new SageHRRateLimitError({
            body,
            endpoint: path,
            retryAfterSeconds: retryAfter,
          });
        }
        if (res.status >= 500 && attempt < this.maxRetries) {
          await sleep(backoffMs(attempt, null));
          attempt++;
          continue;
        }
        throw new SageHRError(`SageHR API error ${res.status} at ${path}`, {
          status: res.status,
          body,
          endpoint: path,
        });
      } catch (err) {
        lastErr = err;
        if (err instanceof SageHRError) throw err;
        // Network errors: retry like 5xx.
        if (attempt < this.maxRetries) {
          await sleep(backoffMs(attempt, null));
          attempt++;
          continue;
        }
        throw err;
      } finally {
        clearTimeout(timer);
        opts.signal?.removeEventListener("abort", onUpstreamAbort);
      }
    }

    throw lastErr ?? new Error("SageHRClient: exhausted retries");
  }

  private buildUrl(path: string, query?: RequestOptions["query"]): string {
    const url = new URL(`${this.baseUrl}${path.startsWith("/") ? path : `/${path}`}`);
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v === undefined || v === null) continue;
        url.searchParams.set(k, String(v));
      }
    }
    return url.toString();
  }
}

function safeParseJson(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function parseRetryAfter(header: string | null): number | null {
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return seconds;
  const date = Date.parse(header);
  if (Number.isFinite(date)) {
    return Math.max(0, Math.round((date - Date.now()) / 1000));
  }
  return null;
}

function backoffMs(attempt: number, retryAfter: number | null): number {
  if (retryAfter !== null) return Math.max(0, retryAfter * 1000);
  // 250ms, 500ms, 1s, 2s ... with full jitter
  const base = 250 * 2 ** attempt;
  return Math.floor(base / 2 + Math.random() * base);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
