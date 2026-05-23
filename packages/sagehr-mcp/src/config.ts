export interface Config {
  subdomain: string;
  apiKey: string;
  userAgent: string;
  logLevel: "info" | "debug";
  httpPort: number;
  bearerToken: string | null;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const subdomain = env.SAGEHR_SUBDOMAIN?.trim();
  const apiKey = env.SAGEHR_API_KEY?.trim();
  if (!subdomain) throw new Error("Missing required env SAGEHR_SUBDOMAIN");
  if (!apiKey) throw new Error("Missing required env SAGEHR_API_KEY");

  const logLevel = env.LOG_LEVEL === "debug" ? "debug" : "info";
  // Railway, Fly, Render and most PaaS providers inject PORT. Prefer it so the
  // server binds to whatever the platform expects without extra config.
  const rawPort = env.PORT ?? env.HTTP_PORT ?? "8787";
  const httpPort = Number(rawPort);
  if (!Number.isFinite(httpPort) || httpPort <= 0) {
    throw new Error(`Invalid PORT/HTTP_PORT: ${rawPort}`);
  }

  return {
    subdomain,
    apiKey,
    userAgent: env.SAGEHR_USER_AGENT?.trim() || "hr-automotion/sagehr-mcp/0.1",
    logLevel,
    httpPort,
    bearerToken: env.MCP_BEARER_TOKEN?.trim() || null,
  };
}
