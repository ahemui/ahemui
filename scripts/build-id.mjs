// One id per `npm run build`, baked into every bundle (overlay, extension, Vite plugin/server) so the overlay can
// tell when the page runs a different build than the project's AhemUI server, e.g. a stale unpacked extension.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const file = join(root, "build-id.json");

/** The release version, from the published package (packages/vite/package.json, npm name "ahemui"). */
export function releaseVersion() {
  return JSON.parse(readFileSync(join(root, "packages", "vite", "package.json"), "utf8")).version;
}

/**
 * Writes a fresh id (called once at the start of the root build) and stamps the plugin version.
 * Release builds (AHEMUI_RELEASE=1, as in CI) get the plain release version, e.g. 0.4.0. Local builds get
 * 0.4.0-dev.<build id>, because `claude plugin update` only installs a version it doesn't have yet.
 */
export function newBuildId() {
  const id = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
  writeFileSync(file, JSON.stringify({ id }) + "\n");
  const version = process.env.AHEMUI_RELEASE === "1" ? releaseVersion() : `${releaseVersion()}-dev.${id}`;
  const pluginJson = join(root, "packages", "claude-plugin", ".claude-plugin", "plugin.json");
  const plugin = JSON.parse(readFileSync(pluginJson, "utf8"));
  plugin.version = version;
  writeFileSync(pluginJson, JSON.stringify(plugin, null, 2) + "\n");
  return id;
}

/** esbuild `define` for the build id ("dev" when building a single package on its own) and the release version. */
export function buildDefine() {
  const id = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")).id : "dev";
  return { __AHEMUI_BUILD__: JSON.stringify(id), __AHEMUI_VERSION__: JSON.stringify(releaseVersion()) };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) console.log(`build id ${newBuildId()}`);
