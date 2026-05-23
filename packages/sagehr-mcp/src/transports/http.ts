import express, { type Request, type Response } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export interface HttpOptions {
  port: number;
  bearerToken: string;
  buildServer: () => McpServer;
}

/**
 * Stateless Streamable HTTP transport.
 *
 * Every POST /mcp request creates a fresh server + transport pair, handles
 * the request, and disposes them when the response closes. There is no
 * session affinity, no in-memory session table, and no SSE stream the
 * client has to keep alive across calls. This is the most robust shape
 * for PaaS deployments (Railway, Fly, etc.) and survives mcp-remote's
 * SSE-disconnect recovery without losing context.
 *
 * GET /mcp and DELETE /mcp are intentionally not implemented — they only
 * matter for stateful, resumable sessions.
 */
export async function runHttp(opts: HttpOptions): Promise<void> {
  const { port, bearerToken, buildServer } = opts;
  const app = express();
  app.use(express.json({ limit: "4mb" }));

  // Bearer auth — the SageHR API key never leaves the server, so callers
  // authenticate via a separate MCP-side token.
  app.use("/mcp", (req, res, next) => {
    const header = req.header("authorization") ?? "";
    const presented = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : null;
    if (!presented || presented !== bearerToken) {
      res.status(401).json({
        jsonrpc: "2.0",
        error: { code: -32001, message: "Unauthorized" },
        id: null,
      });
      return;
    }
    next();
  });

  app.post("/mcp", async (req: Request, res: Response) => {
    const server = buildServer();
    const transport = new StreamableHTTPServerTransport({
      // undefined = stateless mode. Every request stands on its own.
      sessionIdGenerator: undefined,
    });

    const cleanup = () => {
      void transport.close();
      void server.close();
    };
    res.on("close", cleanup);

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      console.error("sagehr-mcp request handling failed:", err);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: {
            code: -32000,
            message: "Internal server error",
            data: err instanceof Error ? err.message : String(err),
          },
          id: null,
        });
      }
      cleanup();
    }
  });

  app.get("/mcp", (_req, res) => {
    res
      .status(405)
      .set("allow", "POST")
      .json({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Method Not Allowed: server runs in stateless mode" },
        id: null,
      });
  });
  app.delete("/mcp", (_req, res) => {
    res
      .status(405)
      .set("allow", "POST")
      .json({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Method Not Allowed: server runs in stateless mode" },
        id: null,
      });
  });

  app.get("/healthz", (_req, res) => {
    res.json({ ok: true, mode: "stateless" });
  });

  await new Promise<void>((resolve) => {
    app.listen(port, () => {
      // stdout, not stderr — HTTP transport has no JSON-RPC-on-stdout constraint,
      // and platforms like Railway classify stderr lines as error-severity.
      console.log(`sagehr-mcp HTTP listening on :${port} (POST /mcp, stateless)`);
      resolve();
    });
  });
}
