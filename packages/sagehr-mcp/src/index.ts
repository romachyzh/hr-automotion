import { loadConfig } from "./config.js";
import { buildServer } from "./server.js";
import { runStdio } from "./transports/stdio.js";
import { runHttp } from "./transports/http.js";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const useHttp = args.includes("--http");
  const config = loadConfig();

  if (useHttp) {
    if (!config.bearerToken) {
      throw new Error("--http requires MCP_BEARER_TOKEN to be set");
    }
    await runHttp({
      port: config.httpPort,
      bearerToken: config.bearerToken,
      buildServer: () => buildServer(config).server,
    });
    return;
  }

  const { server } = buildServer(config);
  await runStdio(server);
}

main().catch((err) => {
  console.error("sagehr-mcp fatal:", err instanceof Error ? (err.stack ?? err.message) : err);
  process.exit(1);
});
