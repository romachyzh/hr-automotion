# hr-automotion

Monorepo of HR automations. Each automation lives in its own workspace under `packages/`.

## Packages

| Package | Purpose |
|---|---|
| [`packages/sagehr-client`](./packages/sagehr-client) | Typed REST client for the SageHR API |
| [`packages/sagehr-mcp`](./packages/sagehr-mcp) | MCP server exposing SageHR data to Claude and other MCP clients |

## Quick start

Requires Node ≥ 20 and pnpm ≥ 10.

```bash
pnpm install
pnpm build
pnpm test
```

To run the SageHR MCP server locally over stdio (the transport Claude Desktop and Claude Code use):

```bash
cd packages/sagehr-mcp
cp .env.example .env   # fill in SAGEHR_SUBDOMAIN and SAGEHR_API_KEY
pnpm dev
```

See [`packages/sagehr-mcp/README.md`](./packages/sagehr-mcp/README.md) for transport options (stdio / Streamable HTTP) and Claude Code / Claude Desktop config snippets.

## Adding a new automation

1. `mkdir -p packages/<name>` with a `package.json` named `@hr-automotion/<name>`
2. Extend `tsconfig.base.json`, use the same build/test/typecheck script names
3. Default to read-only v1; gate any writes behind explicit approval per tool
