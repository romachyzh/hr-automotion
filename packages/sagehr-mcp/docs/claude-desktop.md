# Connecting `sagehr-mcp` to Claude Desktop

This guide walks you through pointing the [Claude Desktop](https://claude.ai/download) app at your local SageHR MCP server so Claude can read employees, leave requests, absences, teams, positions, and policies from your SageHR tenant.

> **Prerequisites**
> - Claude Desktop installed and logged in
> - Node.js ≥ 20 on your machine (`node --version`)
> - Admin permissions on your SageHR account (needed to generate the API key)
> - This repo cloned somewhere stable (the path goes into Claude's config and shouldn't move)

---

## 1. Build the server

From the repo root:

```bash
pnpm install
pnpm --filter @hr-automotion/sagehr-mcp build
```

That produces `packages/sagehr-mcp/dist/index.js`, which is the file Claude Desktop will launch.

Quick sanity check — the binary should accept a JSON-RPC `initialize` and reply with the server info:

```bash
SAGEHR_SUBDOMAIN=test SAGEHR_API_KEY=fake \
  node packages/sagehr-mcp/dist/index.js <<'EOF'
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}}
EOF
```

You should see a JSON line containing `"serverInfo":{"name":"sagehr-mcp","version":"0.1.0"}`. If you do, the server is ready. Press `Ctrl+C` to exit.

---

## 2. Get a SageHR API key

1. Log into SageHR as an **admin** (the API section is hidden for non-admin users)
2. Go to **Settings → Integrations → API**
3. Click **Generate API key** if one isn't already there
4. Copy the key — you won't be shown it again in plain text on most tenants
5. Note your tenant subdomain — it's the prefix in your SageHR URL: `https://<subdomain>.sage.hr`

---

## 3. Locate Claude Desktop's config file

Claude Desktop reads `claude_desktop_config.json` on startup:

| OS | Path |
|---|---|
| macOS | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Windows | `%APPDATA%\Claude\claude_desktop_config.json` |
| Linux | `~/.config/Claude/claude_desktop_config.json` |

If the file doesn't exist yet, create it with an empty object `{}` and proceed. The fastest way to open it is from Claude Desktop itself: **Settings → Developer → Edit Config**.

---

## 4. Add the SageHR MCP server entry

Open the config file and add a `sagehr` server under `mcpServers`. If you already have other MCP servers configured, keep them — just add the new entry.

**Minimal config (recommended):**

```json
{
  "mcpServers": {
    "sagehr": {
      "command": "node",
      "args": [
        "/ABSOLUTE/PATH/TO/hr-automotion/packages/sagehr-mcp/dist/index.js"
      ],
      "env": {
        "SAGEHR_SUBDOMAIN": "your-subdomain",
        "SAGEHR_API_KEY": "paste-your-real-key-here"
      }
    }
  }
}
```

Replace the placeholders:
- `/ABSOLUTE/PATH/TO/hr-automotion/...` — use the **full absolute path** to `dist/index.js`. Relative paths and `~` will not work. On macOS, run `pwd` inside the `packages/sagehr-mcp` directory to get yours.
- `your-subdomain` — e.g. `acme` if your URL is `https://acme.sage.hr`
- `paste-your-real-key-here` — the key from step 2

> The API key lives in this config file on your disk. Make sure your machine is encrypted at rest and you're not syncing this file to anywhere public.

**With optional tuning:**

```json
{
  "mcpServers": {
    "sagehr": {
      "command": "node",
      "args": [
        "/Users/you/Projects/hr-automotion/packages/sagehr-mcp/dist/index.js"
      ],
      "env": {
        "SAGEHR_SUBDOMAIN": "acme",
        "SAGEHR_API_KEY": "sk_...",
        "SAGEHR_USER_AGENT": "claude-desktop/sagehr-mcp",
        "LOG_LEVEL": "info"
      }
    }
  }
}
```

---

## 5. Restart Claude Desktop

Fully quit (not just close the window) and reopen Claude Desktop. On macOS that's **Claude → Quit Claude** or `Cmd+Q`. On Windows, right-click the tray icon → **Quit**.

MCP servers are launched on app startup, so this restart is required for the config to take effect.

---

## 6. Verify the connection

1. Open a new chat in Claude Desktop
2. Click the **tools** icon (or run the **`/mcp`** slash command if available in your version)
3. You should see **`sagehr`** listed with 10 tools:
   - `sagehr_whoami`
   - `sagehr_list_employees`
   - `sagehr_get_employee`
   - `sagehr_search_employees`
   - `sagehr_list_leave_requests`
   - `sagehr_get_leave_request`
   - `sagehr_list_absences`
   - `sagehr_list_teams`
   - `sagehr_list_positions`
   - `sagehr_list_leave_policies`
4. Type: **"Use the sagehr tools to run whoami and tell me which tenant you're connected to."**

If Claude returns the subdomain you configured and `api_reachable: true`, you're live.

Good follow-up prompts:
- *"List the first 10 employees with their teams."*
- *"Who's out of office this week?"* (Claude will figure out today's date and call `sagehr_list_absences`)
- *"Show me approved leave requests for May 2026."*

---

## Troubleshooting

**Claude doesn't show the `sagehr` server in the tools list.**
- Make sure you fully quit and relaunched the app
- Check the config file is valid JSON (a stray comma will silently break the whole MCP section)
- Look at Claude Desktop's MCP logs:
  - macOS: `~/Library/Logs/Claude/mcp*.log`
  - Windows: `%APPDATA%\Claude\logs\mcp*.log`

**You see "Missing required env SAGEHR_SUBDOMAIN" in the logs.**
- The `env` block in `claude_desktop_config.json` isn't reaching the process. Check JSON syntax, then restart.

**Tools return `SageHRAuthError` (status 401).**
- The API key is wrong, was rotated, or the key belongs to a non-admin user. Regenerate it in SageHR settings and update the config.

**Tools return `SageHRNotFoundError` (status 404) for endpoints you'd expect to work.**
- Your tenant's exact endpoint path may differ from the defaults the client uses. The strings live in `packages/sagehr-client/src/resources/*.ts` — edit there, rebuild, and restart Claude Desktop.

**Claude reports the server "crashed" or "disconnected".**
- Run the smoke command from step 1 manually to see the real error
- Make sure Node is on the system PATH that Claude Desktop sees. If you installed Node via `nvm`, set `"command"` to the absolute Node binary path, e.g. `"/Users/you/.nvm/versions/node/v20.18.0/bin/node"`

**You want to change the SageHR key without rebuilding.**
- The `dist/index.js` file is static; only `env` in the config matters. Edit the key, restart Claude Desktop. No rebuild needed.

---

## Updating the server later

When you pull new changes in this repo:

```bash
git pull
pnpm install
pnpm --filter @hr-automotion/sagehr-mcp build
```

Then fully restart Claude Desktop. The config file does not need to change unless tools were added or renamed.
