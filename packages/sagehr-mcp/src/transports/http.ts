import express, { type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export interface HttpOptions {
  port: number;
  bearerToken: string;
  buildServer: () => McpServer;
}

/**
 * Streamable HTTP transport per MCP spec (POST /mcp + optional GET SSE).
 * One transport per session, keyed by mcp-session-id header.
 */
export async function runHttp(opts: HttpOptions): Promise<void> {
  const { port, bearerToken, buildServer } = opts;
  const app = express();
  app.use(express.json({ limit: "4mb" }));

  const transports = new Map<string, StreamableHTTPServerTransport>();

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
    const sessionId = req.header("mcp-session-id");
    let transport = sessionId ? transports.get(sessionId) : undefined;

    if (!transport) {
      if (!isInitializeRequest(req.body)) {
        res.status(400).json({
          jsonrpc: "2.0",
          error: { code: -32000, message: "No active session; send `initialize` first." },
          id: null,
        });
        return;
      }
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => {
          transports.set(id, transport!);
        },
      });
      transport.onclose = () => {
        if (transport!.sessionId) transports.delete(transport!.sessionId);
      };
      const server = buildServer();
      await server.connect(transport);
    }

    await transport.handleRequest(req, res, req.body);
  });

  const handleSession = async (req: Request, res: Response) => {
    const sessionId = req.header("mcp-session-id");
    const transport = sessionId ? transports.get(sessionId) : undefined;
    if (!transport) {
      res.status(400).send("Invalid or missing session id");
      return;
    }
    await transport.handleRequest(req, res);
  };
  app.get("/mcp", handleSession);
  app.delete("/mcp", handleSession);

  app.get("/healthz", (_req, res) => {
    res.json({ ok: true, sessions: transports.size });
  });

  await new Promise<void>((resolve) => {
    app.listen(port, () => {
      // stdout, not stderr — HTTP transport has no JSON-RPC-on-stdout constraint,
      // and platforms like Railway classify stderr lines as error-severity.
      console.log(`sagehr-mcp HTTP listening on :${port} (POST /mcp)`);
      resolve();
    });
  });
}
