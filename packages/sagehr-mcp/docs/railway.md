# Deploying `sagehr-mcp` to Railway

This guide walks you through deploying the SageHR MCP server to [Railway](https://railway.com) so you (or your whole team) can connect to it over HTTPS instead of running a local process per machine.

> **Prerequisites**
> - A Railway account and the [Railway CLI](https://docs.railway.com/guides/cli) (`npm i -g @railway/cli`)
> - SageHR admin access (for the API key)
> - This repo pushed to GitHub if you want auto-deploys, OR just locally if you'll use `railway up`

---

## 1. What gets deployed

Railway runs:

```bash
node packages/sagehr-mcp/dist/index.js --http
```

That starts the **Streamable HTTP transport** on whatever port Railway injects via `$PORT`. The server exposes:

- `POST /mcp` — JSON-RPC endpoint (bearer-auth required)
- `GET  /mcp` and `DELETE /mcp` — SSE / session lifecycle
- `GET  /healthz` — used by Railway's healthcheck

The repo ships [`railway.json`](../../../railway.json) which wires the build and deploy commands automatically.

---

## 2. One-time setup

```bash
npm i -g @railway/cli
railway login
```

From the repo root:

```bash
railway init     # pick "Empty Project", or link to an existing one
```

---

## 3. Set environment variables

These are stored encrypted at rest on Railway and never end up in the deployed image.

```bash
# Your SageHR tenant
railway variables --set "SAGEHR_SUBDOMAIN=acme"
railway variables --set "SAGEHR_API_KEY=sk_live_..."

# Auth token that Claude / curl will send as `Authorization: Bearer ...`
# Generate fresh — do not reuse anything you've pasted elsewhere.
TOKEN=$(node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))")
echo "Save this: $TOKEN"
railway variables --set "MCP_BEARER_TOKEN=$TOKEN"

# Optional
railway variables --set "SAGEHR_USER_AGENT=railway/sagehr-mcp"
railway variables --set "LOG_LEVEL=info"
```

> Don't set `PORT` yourself — Railway injects it. The server reads `PORT` ahead of `HTTP_PORT` automatically.

---

## 4. Deploy

```bash
railway up
```

Railway picks up `railway.json`, runs the build command (`pnpm install --frozen-lockfile && pnpm --filter @hr-automotion/sagehr-mcp build`), and starts the service.

Watch the logs:

```bash
railway logs
```

You should see:

```
sagehr-mcp HTTP listening on :<port> (POST /mcp)
```

---

## 5. Get the public URL

```bash
railway domain    # creates one if none exists
```

You'll get back something like `sagehr-mcp-production.up.railway.app`. The MCP endpoint is at `https://<that-domain>/mcp`.

Smoke-test it:

```bash
URL=https://sagehr-mcp-production.up.railway.app
TOKEN="<value you saved in step 3>"

# health
curl -sS $URL/healthz
# -> {"ok":true,"sessions":0}

# JSON-RPC initialize
curl -sSi -X POST $URL/mcp \
  -H "content-type: application/json" \
  -H "accept: application/json, text/event-stream" \
  -H "authorization: Bearer $TOKEN" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"curl","version":"0"}}}'
```

Look at the response headers for `mcp-session-id: <uuid>` — that's your session. Reuse it on follow-up calls:

```bash
SID=<the uuid from the init response>
curl -sS -X POST $URL/mcp \
  -H "content-type: application/json" \
  -H "accept: application/json, text/event-stream" \
  -H "authorization: Bearer $TOKEN" \
  -H "mcp-session-id: $SID" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'
```

You should get back all 10 SageHR tools.

---

## 6. Connect Claude Desktop to the Railway URL

Two paths, depending on your Claude plan and app version.

### Option A — Native remote MCP (Custom Connectors)

Newer Claude Desktop builds on Pro / Team / Enterprise plans support remote MCP servers directly.

1. **Claude Desktop → Settings → Connectors → Add custom connector**
2. URL: `https://sagehr-mcp-production.up.railway.app/mcp`
3. Authentication: **Bearer token**, paste your `MCP_BEARER_TOKEN`
4. Save, then start a new chat — the `sagehr` tools appear automatically

### Option B — Stdio bridge via `mcp-remote` (works on every plan)

Edit `claude_desktop_config.json` (paths in [`claude-desktop.md`](./claude-desktop.md)):

```json
{
  "mcpServers": {
    "sagehr": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote",
        "https://sagehr-mcp-production.up.railway.app/mcp",
        "--header",
        "Authorization: Bearer YOUR_MCP_BEARER_TOKEN"
      ]
    }
  }
}
```

Fully quit and relaunch Claude Desktop. The local `mcp-remote` proxy spawns on demand and forwards JSON-RPC over HTTPS to Railway. Your SageHR API key never leaves Railway.

---

## 7. Auto-deploy on `git push` (optional)

In the Railway dashboard for your service:

1. **Settings → Source → Connect Repo** and pick your GitHub repo
2. Set the deploy branch (usually `main`)
3. Every push to that branch now triggers a rebuild

Railway respects the same `railway.json`, so no extra config needed.

---

## Updating credentials

```bash
railway variables --set "SAGEHR_API_KEY=new-key"
railway redeploy
```

Restart not strictly required if the deploy succeeds — the next inbound request rebuilds the client with the new key.

To rotate the bearer token, generate a new one, set it on Railway, redeploy, then update Claude Desktop's config. There's no token revocation list — the only valid token is whatever `MCP_BEARER_TOKEN` currently is.

---

## Troubleshooting

**Build fails with "pnpm: command not found".**
The build command uses `corepack enable` to install pnpm. If Railway's Node version is too old, pin it: add `"engines": { "node": ">=20" }` (already present at the repo root) and ensure Nixpacks picks the right Node. You can also set `NIXPACKS_NODE_VERSION=20` as an env var.

**Healthcheck fails immediately after deploy.**
Look at `railway logs` for a `Missing required env` error. The most common cause is a typo in `SAGEHR_SUBDOMAIN` or forgetting `MCP_BEARER_TOKEN` (required whenever `--http` is the start command).

**`401 Unauthorized` on every request.**
Either `MCP_BEARER_TOKEN` isn't set on Railway, or the `Authorization: Bearer …` header you're sending doesn't match it. Whitespace and quoting bite here — double-check with `railway variables`.

**`No active session; send initialize first.`**
Streamable HTTP is session-based. Always issue `initialize` first, capture the `mcp-session-id` response header, and send it on every follow-up request. `mcp-remote` and Claude's native client handle this automatically.

**Cold starts are slow.**
First request after idle wakes the container — that's a Railway-platform behavior, not the server. If responsiveness matters, set a higher minimum instance count in the Railway dashboard.
