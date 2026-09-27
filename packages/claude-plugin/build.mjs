import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { copyFile, mkdir, readdir, rename, rm } from "node:fs/promises";

await build({
  entryPoints: ["src/mcp.ts"],
  outfile: "server/snap-mcp.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node18",
  banner: { js: 'import { createRequire as __snapCreateRequire } from "node:module"; const require = __snapCreateRequire(import.meta.url);' },
  logLevel: "warning",
});

// The CLI (for `snap wait` in /snap:watch) runs from the plugin, so projects don't need @snap/vite installed for it.
await mkdir("bin", { recursive: true });
await copyFile("../vite/dist/cli.js", "bin/snap.mjs");

// Ship @snap/vite inside the plugin so /snap:setup can vendor it into projects before it's on npm.
await rm("vendor", { recursive: true, force: true });
await mkdir("vendor");
execFileSync("npm", ["pack", "../vite", "--pack-destination", "vendor", "--silent"], { stdio: "inherit", shell: true });
const [tgz] = (await readdir("vendor")).filter((f) => f.endsWith(".tgz"));
await rename(`vendor/${tgz}`, "vendor/snap-vite.tgz");
console.log("plugin built → packages/claude-plugin (server/snap-mcp.mjs, vendor/snap-vite.tgz)");
