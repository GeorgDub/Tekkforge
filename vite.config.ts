import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

// GUI-Build: eine einzige selbsttragende HTML-Datei (dist/index.html) —
// doppelklickbar, kein Server/Install nötig. CLI wird separat via esbuild
// nach dist/cli.mjs gebaut (scripts/build-cli.mjs), daher emptyOutDir: false.
export default defineConfig({
  plugins: [viteSingleFile()],
  build: {
    target: "es2020",
    outDir: "dist",
    emptyOutDir: false,
  },
});
