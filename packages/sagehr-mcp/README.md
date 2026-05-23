# @hr-automotion/sagehr-mcp

MCP server that exposes a SageHR tenant to Claude (and any other MCP client) over **stdio** or **Streamable HTTP**.

All tools are **read-only** in v1.

## Tools

| Tool | Purpose |
|---|---|
| `sagehr_whoami` | Verify connectivity and report tenant subdomain |
| `sagehr_list_employees` | Paged employee directory (filter by team or status) |
| `sagehr_get_employee` | Single employee by id |
| `sagehr_search_employees` | Fuzzy substring search by name / email |
| `sagehr_list_leave_requests` | Leave requests with date-range and status filters |
| `sagehr_get_leave_request` | Single leave request by id |
| `sagehr_list_absences` | Out-of-office in a date range |
| `sagehr_list_teams` | All teams |
| `sagehr_list_positions` | All positions / job titles |
| `sagehr_list_leave_policies` | Policies, plus balances if `employee_id` is given |

## Setup

```bash
pnpm install                  # from repo root
cd packages/sagehr-mcp
cp .env.example .env
# edit .env, fill SAGEHR_SUBDOMAIN and SAGEHR_API_KEY
```

Get your SageHR API key from **Settings → Integrations → API** in your SageHR account (requires admin permissions).

## Run

**Stdio (local — what Claude Desktop / Claude Code use):**

```bash
pnpm dev          # tsx hot-run
# or built:
pnpm build && node dist/index.js
```

**Streamable HTTP (remote / team deployment):**

```bash
# .env must also include MCP_BEARER_TOKEN
pnpm dev:http
# or built:
pnpm build && node dist/index.js --http
```

## Use from Claude Code

Add to your project's `.mcp.json` or your user-level Claude config:

```json
{
  "mcpServers": {
    "sagehr": {
      "command": "node",
      "args": ["/absolute/path/to/hr-automotion/packages/sagehr-mcp/dist/index.js"],
      "env": {
        "SAGEHR_SUBDOMAIN": "acme",
        "SAGEHR_API_KEY": "..."
      }
    }
  }
}
```

After restarting Claude Code, run `/mcp` and you should see the 10 tools listed under `sagehr`.

## Use from Claude Desktop

See the full step-by-step walkthrough — including OS-specific config paths, prerequisites, verification prompts, and troubleshooting — in [`docs/claude-desktop.md`](./docs/claude-desktop.md).

TL;DR (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):

```json
{
  "mcpServers": {
    "sagehr": {
      "command": "node",
      "args": ["/absolute/path/to/hr-automotion/packages/sagehr-mcp/dist/index.js"],
      "env": {
        "SAGEHR_SUBDOMAIN": "acme",
        "SAGEHR_API_KEY": "..."
      }
    }
  }
}
```

Fully quit and relaunch Claude Desktop after editing the config.

## Verify HTTP transport with curl

```bash
TOKEN=$MCP_BEARER_TOKEN
curl -sS -X POST http://localhost:8787/mcp \
  -H "content-type: application/json" \
  -H "accept: application/json, text/event-stream" \
  -H "authorization: Bearer $TOKEN" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"curl","version":"0"}}}'
```

Capture the `mcp-session-id` response header, then list tools:

```bash
curl -sS -X POST http://localhost:8787/mcp \
  -H "content-type: application/json" \
  -H "accept: application/json, text/event-stream" \
  -H "authorization: Bearer $TOKEN" \
  -H "mcp-session-id: <id-from-init>" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'
```

## Environment variables

| Var | Required | Default | Notes |
|---|---|---|---|
| `SAGEHR_SUBDOMAIN` | yes | — | e.g. `acme` for `https://acme.sage.hr` |
| `SAGEHR_API_KEY` | yes | — | From SageHR Settings → Integrations → API |
| `MCP_BEARER_TOKEN` | only with `--http` | — | Random long string; clients send as `Authorization: Bearer …` |
| `SAGEHR_USER_AGENT` | no | `hr-automotion/sagehr-mcp/0.1` | Sent on every SageHR request |
| `HTTP_PORT` | no | `8787` | HTTP transport port |
| `LOG_LEVEL` | no | `info` | `info` or `debug` |
