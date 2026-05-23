import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node20",
  dts: false,
  sourcemap: true,
  clean: true,
  banner: { js: "#!/usr/bin/env node" },
  // Bundle our own workspace packages into the output so the deployed dist/
  // doesn't depend on packages/*/dist being present at runtime. Third-party
  // deps stay external and resolve from node_modules normally.
  noExternal: [/^@hr-automotion\//],
});
