import { build } from "esbuild";

await build({
  entryPoints: ["src/cli.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node18",
  outfile: "dist/cli.mjs",
  banner: { js: "#!/usr/bin/env node" },
  logLevel: "info",
});
