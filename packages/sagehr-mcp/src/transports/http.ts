import { timingSafeEqual } from "node:crypto";
import express, { type Request, type Response, type NextFunction } from "express";
import cookieParser from "cookie-parser";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SageHRClient } from "@hr-automotion/sagehr-client";
import { buildDashboardReport } from "../reporting/dashboard-report.js";
import { resolveDashboardDistDir } from "./dashboard-assets.js";

export interface HttpOptions {
  port: number;
  bearerToken: string;
  buildServer: () => McpServer;
  /** Shared client for the dashboard data API (reused across requests). */
  client: SageHRClient;
  /** Enables the dashboard when set; null serves MCP only. */
  dashboardPassword: string | null;
  /** Signs the session cookie. Required when dashboardPassword is set. */
  sessionSecret: string | null;
  /** Override for the built dashboard asset directory. */
  dashboardDistDir: string | null;
}

const SESSION_COOKIE = "dash_session";
const SESSION_VALUE = "ok"; // signed; presence of a valid signature is the auth
const DASHBOARD_CACHE_TTL_MS = 60_000;

/**
 * Stateless Streamable HTTP transport, plus an optional password-gated web
 * dashboard served from the same Express app.
 *
 * MCP: every POST /mcp request creates a fresh server + transport pair, handles
 * the request, and disposes them when the response closes. There is no session
 * affinity, no in-memory session table, and no SSE stream the client has to
 * keep alive across calls. GET /mcp and DELETE /mcp are intentionally not
 * implemented — they only matter for stateful, resumable sessions.
 *
 * Dashboard (only when dashboardPassword is set): POST /api/login exchanges the
 * shared password for a signed httpOnly cookie; /api/* requires that cookie;
 * GET /api/dashboard returns the aggregated report; the built SPA is served as
 * static files with an index.html fallback for client-side routes.
 */
export async function runHttp(opts: HttpOptions): Promise<void> {
  const { port, bearerToken, buildServer, client, dashboardPassword, sessionSecret } = opts;
  const app = express();
  app.use(express.json({ limit: "4mb" }));
  if (sessionSecret) app.use(cookieParser(sessionSecret));

  // --- MCP bearer auth (the SageHR API key never leaves the server, so
  // callers authenticate via a separate MCP-side token). ---
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
    res.json({ ok: true, mode: "stateless", dashboard: Boolean(dashboardPassword) });
  });

  // --- Dashboard (opt-in) ---
  if (dashboardPassword && sessionSecret) {
    registerDashboardRoutes(app, {
      client,
      dashboardPassword,
      distDir: resolveDashboardDistDir(opts.dashboardDistDir),
    });
  } else {
    console.log("sagehr-mcp dashboard disabled (set DASHBOARD_PASSWORD + SESSION_SECRET to enable)");
  }

  await new Promise<void>((resolve) => {
    app.listen(port, () => {
      // stdout, not stderr — HTTP transport has no JSON-RPC-on-stdout constraint,
      // and platforms like Railway classify stderr lines as error-severity.
      console.log(`sagehr-mcp HTTP listening on :${port} (POST /mcp, stateless)`);
      resolve();
    });
  });
}

interface DashboardDeps {
  client: SageHRClient;
  dashboardPassword: string;
  distDir: string | null;
}

function registerDashboardRoutes(
  app: express.Express,
  { client, dashboardPassword, distDir }: DashboardDeps,
): void {
  const inProd = process.env.NODE_ENV === "production";

  app.post("/api/login", (req: Request, res: Response) => {
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    if (!passwordMatches(password, dashboardPassword)) {
      res.status(401).json({ error: "Invalid password" });
      return;
    }
    res.cookie(SESSION_COOKIE, SESSION_VALUE, {
      httpOnly: true,
      sameSite: "lax",
      secure: inProd,
      signed: true,
      maxAge: 12 * 60 * 60 * 1000, // 12h
    });
    res.json({ ok: true });
  });

  app.post("/api/logout", (_req: Request, res: Response) => {
    res.clearCookie(SESSION_COOKIE);
    res.json({ ok: true });
  });

  // Everything else under /api requires a valid signed session cookie.
  app.use("/api", requireSession);

  const cache = new Map<string, { at: number; data: unknown }>();
  app.get("/api/dashboard", (req: Request, res: Response) => {
    void (async () => {
      const from = strParam(req.query.from);
      const to = strParam(req.query.to);
      const teamId = strParam(req.query.team_id);
      const key = `${from ?? ""}|${to ?? ""}|${teamId ?? ""}`;

      const hit = cache.get(key);
      if (hit && Date.now() - hit.at < DASHBOARD_CACHE_TTL_MS) {
        res.json(hit.data);
        return;
      }
      try {
        const report = await buildDashboardReport(client, {
          ...(from ? { from } : {}),
          ...(to ? { to } : {}),
          ...(teamId ? { teamId } : {}),
        });
        cache.set(key, { at: Date.now(), data: report });
        res.json(report);
      } catch (err) {
        console.error("dashboard report failed:", err);
        res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
      }
    })();
  });

  // --- Static SPA assets ---
  if (distDir) {
    app.use(express.static(distDir));
    // SPA fallback: serve index.html for non-API GET routes so client-side
    // routing works. Exclude /api, /mcp, /healthz. Regex (not "*") avoids the
    // Express 4 path-to-regexp wildcard pitfalls.
    app.get(/^\/(?!api\/|mcp$|mcp\/|healthz$).*/, (_req: Request, res: Response) => {
      res.sendFile("index.html", { root: distDir });
    });
    console.log(`sagehr-mcp dashboard enabled, serving SPA from ${distDir}`);
  } else {
    console.log("sagehr-mcp dashboard API enabled, but no built assets found (API-only)");
  }
}

function requireSession(req: Request, res: Response, next: NextFunction): void {
  if (req.signedCookies?.[SESSION_COOKIE] === SESSION_VALUE) {
    next();
    return;
  }
  res.status(401).json({ error: "Not authenticated" });
}

function passwordMatches(presented: string, expected: string): boolean {
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  // timingSafeEqual requires equal lengths; length difference is already a
  // mismatch, but compare against a fixed buffer to keep timing uniform.
  if (a.length !== b.length) {
    timingSafeEqual(b, b);
    return false;
  }
  return timingSafeEqual(a, b);
}

function strParam(value: unknown): string | undefined {
  if (typeof value === "string" && value.length > 0) return value;
  return undefined;
}
