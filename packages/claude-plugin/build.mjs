import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { copyFile, mkdir, readdir, rename, rm } from "node:fs/promises";

await build({
  entryPoints: ["src/mcp.ts"],
  outfile: "server/ahemui-mcp.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node18",
  banner: { js: 'import { createRequire as __ahemuiCreateRequire } from "node:module"; const require = __ahemuiCreateRequire(import.meta.url);' },
  logLevel: "warning",
});

// The CLI (for `ahemui wait` in /ahemui:watch) runs from the plugin, so projects don't need ahemui installed for it.
await mkdir("scripts", { recursive: true });
await copyFile("../vite/dist/cli.js", "scripts/ahemui.mjs");

// Ship ahemui inside the plugin so /ahemui:setup can vendor it into projects before it's on npm.
await rm("vendor", { recursive: true, force: true });
await mkdir("vendor");
execFileSync("npm", ["pack", "../vite", "--pack-destination", "vendor", "--silent"], { stdio: "inherit", shell: true });
const [tgz] = (await readdir("vendor")).filter((f) => f.endsWith(".tgz"));
await rename(`vendor/${tgz}`, "vendor/ahemui.tgz");
console.log("plugin built → packages/claude-plugin (server/ahemui-mcp.mjs, vendor/ahemui.tgz)");
