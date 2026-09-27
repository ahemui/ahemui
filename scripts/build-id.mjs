// One id per `npm run build`, baked into every bundle (overlay, extension, Vite plugin/server) so the overlay can
// tell when the page runs a different build than the project's AhemUI server, e.g. a stale unpacked extension.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const file = join(dirname(fileURLToPath(import.meta.url)), "..", "build-id.json");

/** Writes a fresh id (called once at the start of the root build) and stamps it into the plugin version. */
export function newBuildId() {
  const id = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
  writeFileSync(file, JSON.stringify({ id }) + "\n");
  // `claude plugin update` only installs a different version, so every build gets one: <major>.<minor>.<build id>.
  const pluginJson = join(dirname(file), "packages", "claude-plugin", ".claude-plugin", "plugin.json");
  const plugin = JSON.parse(readFileSync(pluginJson, "utf8"));
  const [major, minor] = String(plugin.version).split(".");
  plugin.version = `${major}.${minor}.${id}`;
  writeFileSync(pluginJson, JSON.stringify(plugin, null, 2) + "\n");
  return id;
}

/** esbuild `define` for the current build id ("dev" when building a single package on its own). */
export function buildDefine() {
  const id = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")).id : "dev";
  return { __AHEMUI_BUILD__: JSON.stringify(id) };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) console.log(`build id ${newBuildId()}`);
