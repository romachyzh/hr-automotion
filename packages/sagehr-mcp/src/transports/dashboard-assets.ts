import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * Resolve the directory of built dashboard static assets.
 *
 * The dashboard package (`@hr-automotion/sagehr-dashboard`) builds its SPA to
 * its own `dist/`. We locate it at RUNTIME by resolving the package's
 * package.json and taking the sibling `dist`. An explicit override
 * (`DASHBOARD_DIST_DIR`) wins. Returns null when nothing usable exists, in
 * which case the HTTP server skips static/SPA routes and serves the API only.
 */
export function resolveDashboardDistDir(override: string | null): string | null {
  if (override) {
    return existsSync(join(override, "index.html")) ? override : null;
  }
  try {
    const require = createRequire(import.meta.url);
    const pkgJson = require.resolve("@hr-automotion/sagehr-dashboard/package.json");
    const dist = join(dirname(pkgJson), "dist");
    return existsSync(join(dist, "index.html")) ? dist : null;
  } catch {
    return null;
  }
}
