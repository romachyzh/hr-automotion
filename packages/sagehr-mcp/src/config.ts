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
  const httpPort = Number(env.HTTP_PORT ?? "8787");
  if (!Number.isFinite(httpPort) || httpPort <= 0) {
    throw new Error(`Invalid HTTP_PORT: ${env.HTTP_PORT}`);
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
