import { build } from "esbuild";
import { buildDefine } from "../../scripts/build-id.mjs";

await build({
  entryPoints: { "overlay-inject": "src/entry-inject.ts", agent: "src/entry-agent.ts" },
  outdir: "dist",
  bundle: true,
  format: "iife",
  target: "chrome111",
  define: buildDefine(),
  minify: true, // axe-core is most of the bundle
  legalComments: "none",
  logLevel: "warning",
});
