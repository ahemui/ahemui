// Bundles the Vite plugin, the `ahemui` CLI and the injected overlay into one dependency-free package.
import { build } from "esbuild";
import { buildDefine } from "../../scripts/build-id.mjs";
import { chmod, copyFile, mkdir, writeFile } from "node:fs/promises";

const common = {
  define: buildDefine(),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node18",
  external: ["vite", "bufferutil", "utf-8-validate"],
  // Bundled CommonJS deps (ws, yaml) call require(); give them one in ESM.
  banner: { js: 'import { createRequire as __ahemuiCreateRequire } from "node:module"; const require = __ahemuiCreateRequire(import.meta.url);' },
  logLevel: "warning",
};

await mkdir("dist", { recursive: true });
await build({ ...common, entryPoints: ["src/index.ts"], outfile: "dist/index.js" });
await build({ ...common, entryPoints: ["../cli/src/index.ts"], outfile: "dist/cli.js", banner: { js: "#!/usr/bin/env node\n" + common.banner.js } });
await chmod("dist/cli.js", 0o755);
await copyFile("../overlay/dist/overlay-inject.js", "dist/overlay-inject.js");
await copyFile("../overlay/dist/agent.js", "dist/agent.js");
await copyFile("../../LICENSE", "LICENSE"); // npm ships it with the package
await writeFile(
  "dist/index.d.ts",
  `import type { Plugin } from "vite";
export interface AhemUIOptions {
  /** Inject the capture overlay into pages (turn off if you only use the browser extension). Default true. */
  overlay?: boolean;
  /** Add data-ahemui-src="file:line:col" to every element in Vue templates. Default true. */
  sourceAttrs?: boolean;
  /** Start ahemui serve inside the Vite process if it isn't already running. Default true. */
  serve?: boolean;
}
export default function ahemui(options?: AhemUIOptions): Plugin;
export declare function ahemuiNodeTransform(root: string): (node: any, context: any) => void;
`,
);
