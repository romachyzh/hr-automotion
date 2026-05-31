import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Built to ./dist; the MCP HTTP server serves these static assets. `base: "./"`
// keeps asset URLs relative so it works regardless of mount path. The dev
// server proxies /api to the local MCP HTTP server (pnpm dev:http on :8787).
export default defineConfig({
  plugins: [react()],
  base: "./",
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:8787",
    },
  },
});
