# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

Run from the repo root (pnpm ≥ 10, Node ≥ 20):

```bash
pnpm install
pnpm build        # builds all packages in dependency order (concurrency=1)
pnpm test         # vitest run across all packages
pnpm typecheck    # builds sagehr-client first, then tsc --noEmit everywhere
pnpm lint         # eslint .
pnpm format       # prettier --write .
```

Per-package work uses pnpm filters:

```bash
pnpm --filter @hr-automotion/sagehr-mcp test
pnpm --filter @hr-automotion/sagehr-client build
```

Run a single test file or test by name (vitest):

```bash
cd packages/sagehr-mcp
pnpm exec vitest run test/server.test.ts
pnpm exec vitest run -t "rejects missing SAGEHR_SUBDOMAIN"
```

Run the MCP server locally:

```bash
cd packages/sagehr-mcp
cp .env.example .env       # set SAGEHR_SUBDOMAIN and SAGEHR_API_KEY
pnpm dev                   # stdio transport (what Claude Desktop/Code use)
pnpm dev:http              # Streamable HTTP; also needs MCP_BEARER_TOKEN
```

## Build ordering (important)

`sagehr-mcp` imports `@hr-automotion/sagehr-client` and resolves it from the client's **built `dist/`**, not its source. So:

- `pnpm build` runs with `--workspace-concurrency=1` so the client builds before the MCP server.
- `pnpm typecheck` explicitly builds the client first for the same reason.
- After changing anything in `sagehr-client`, rebuild it (`pnpm --filter @hr-automotion/sagehr-client build`) before typechecking or running the MCP server, or the MCP package will see stale types.

The MCP build (`tsup.config.ts`) bundles `@hr-automotion/*` into its output (`noExternal`), so the deployed `dist/index.js` does not depend on the client's `dist/` at runtime.

## Architecture

Monorepo under `packages/`:

```
sagehr-client     (typed REST client for the SageHR API)
      ▲
      │ workspace:*
sagehr-mcp        (MCP server + Express HTTP transport; also serves the dashboard API)
      ▲
      │ workspace:* (runtime asset serving only — NOT a build/import dependency)
sagehr-dashboard  (React + Vite SPA, built to static assets)
```

### sagehr-client

A thin, **read-only** (GET-only) typed wrapper over `https://{subdomain}.sage.hr/api`. Layers:

- `client.ts` — `SageHRClient.request()` is the single chokepoint: auth header (`X-Auth-Token`), timeout via `AbortController`, and retry/backoff on 429 (honors `Retry-After`) and 5xx/network errors. `RequestOptions.method` is typed as `"GET"` only — this is deliberate; v1 is read-only.
- `resources/*.ts` — one class per SageHR collection (employees, leave-requests, absences, teams, positions, policies). Each holds its endpoint path strings (the *only* place those literals live), calls `client.request`, and validates the response with a zod schema.
- `schemas/*.ts` — zod schemas + exported TS types. Schemas are intentionally **permissive** (lots of `.optional()`/`.passthrough`-style tolerance) because field presence varies by tenant. `computeLeaveDays()` lives here because SageHR does not return a day count on leave requests — it's derived from dates + part-of-day flags.
- `pagination.ts` — `paginate()` async-generator walks pages until exhausted; `chunkDateRange()` splits a date range into ≤60-day windows to stay under SageHR's hard 65-day cap on leave endpoints.
- `index.ts` is the public surface; only re-exported symbols are usable from `sagehr-mcp`.

### sagehr-mcp

Wraps client resources as MCP tools. Flow: `index.ts` (arg parse: `--http` vs stdio) → `config.ts` (`loadConfig` validates env) → `server.ts` (`buildServer` constructs the client + `McpServer` and calls each `registerXxxTools`) → `transports/` (stdio or HTTP).

- `tools/*.ts` — each exports a `registerXxxTools(server, client)` that calls `server.registerTool`. Tool inputs are zod schemas; bodies wrap the call in `withErrorHandling` (from `tools/_helpers.ts`), which renders success as pretty-printed JSON and converts `SageHRError` into a structured `isError` result carrying the SageHR response body.
- `reporting/leave-aggregation.ts` — shared aggregation helpers (`aggregateByPolicy`, `normaliseStatus`, `describeDayCounting`, policy-name enrichment, YTD date defaults). Consumed by **both** `tools/leave-summary.ts` (the MCP tools) and `reporting/dashboard-report.ts` — one implementation, no divergence. Don't re-inline this logic into a tool.
- `reporting/dashboard-report.ts` — `buildDashboardReport(client, {from,to,teamId?})` powers the dashboard data API: per-employee per-policy *used* (approved business days, YTD) + *remaining* (balances endpoint with a `default_allowance − used` fallback; each cell records `remaining_source`), plus `by_team`/`by_policy` rollups. Balances are per-employee, so it probes the first employee then fans out with a small concurrency pool.
- `transports/http.ts` — **stateless** Streamable HTTP: a fresh `McpServer`+transport per POST `/mcp`, bearer-auth via `MCP_BEARER_TOKEN` (separate from the SageHR key, which never leaves the server). `GET`/`DELETE /mcp` return 405; `/healthz` for platform health checks. When `DASHBOARD_PASSWORD`+`SESSION_SECRET` are set it also mounts the dashboard: `POST /api/login` → signed httpOnly cookie, cookie-gated `GET /api/dashboard`, and the built SPA via `express.static` + a regex SPA fallback. `transports/stdio.ts` is the default transport.

### sagehr-dashboard

React + Vite + TS SPA. Talks only to `/api/*` on the MCP HTTP server (`src/api.ts`), so the SageHR key stays server-side. `src/types.ts` is a hand-written mirror of the `buildDashboardReport` JSON contract — **keep the two in sync**. `vite.config.ts` proxies `/api` → `localhost:8787` for local dev. The MCP server locates the built assets at **runtime** via `createRequire(...).resolve("@hr-automotion/sagehr-dashboard/package.json")` (`transports/dashboard-assets.ts`); it is therefore *not* a build/import dependency of `sagehr-mcp` (tsup does not bundle it), and a missing `dist/` degrades to API-only rather than crashing.

### Adding a new MCP tool

1. If a new endpoint is needed, add/extend a resource in `sagehr-client/src/resources/` and its schema in `schemas/`, re-export from `index.ts`, then **rebuild the client**.
2. Register the tool in the relevant `sagehr-mcp/src/tools/*.ts` (or a new file wired into `server.ts`).
3. `test/server.test.ts` asserts the exact set of registered tool names — update that list when adding/removing a tool, or the test fails.

## SageHR API quirks to respect

These are baked into the code and have comments at the relevant call sites — don't "fix" them away:

- **65-day range cap** on `/leave-management/*` → use `chunkDateRange` / the resources' `listAll`, never pass a raw long range.
- **`page_size` is silently ignored** on `/employees` → the list tool truncates client-side and reports `client_truncated`.
- **No employee search endpoint** → `sagehr_search_employees` iterates the whole directory; cost is linear in headcount.
- **Leave status** comes as both `status_code` (machine) and `status` (human, varying case) → normalize via the prefer-code-then-fuzzy logic in `reporting/leave-aggregation.ts` (`normaliseStatus`).
- **No precomputed day count / no business-day count** on leave requests → `computeLeaveDays` (client) derives business days (Mon–Fri) by default, with `{countWeekends, holidays}` options. The balances endpoint (`/employees/{id}/leave-balances`) is **unverified and 404s on some tenants** → always have a computed fallback.
- **Single-resource responses** are `{ data: {...} }` → resources unwrap `.data`.

## Conventions

- ESM throughout (`"type": "module"`), `NodeNext` resolution → **relative imports must use the `.js` extension** even in `.ts` source.
- Strict TypeScript incl. `noUncheckedIndexedAccess`. eslint enforces `consistent-type-imports`; unused vars allowed only with a leading `_`.
- Default new automations to read-only v1; gate any write behind explicit per-tool approval (see README "Adding a new automation").

## Deployment

`railway.json` deploys `sagehr-mcp` in HTTP mode (`node packages/sagehr-mcp/dist/index.js --http`). Config reads `PORT` (PaaS convention) before `HTTP_PORT`. The dashboard is enabled by setting `DASHBOARD_PASSWORD` + `SESSION_SECRET` (a password without a secret throws at startup; unset password = MCP-only); `pnpm -r build` already builds `sagehr-dashboard`, so its `dist/` exists for the server to serve. CI (`.github/workflows/ci.yml`) runs lint → typecheck → build → test on push/PR. See `packages/sagehr-mcp/docs/` for Claude Desktop and Railway setup.
