// Sets the release version everywhere it's written down: the npm package, the extension manifest, the plugin
// manifest, and a new CHANGELOG heading for what's under [Unreleased].
//   node scripts/set-version.mjs 0.4.1
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const version = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(version ?? "")) {
  console.error("usage: node scripts/set-version.mjs <major.minor.patch>");
  process.exit(1);
}

const json = (rel, update) => {
  const file = join(root, rel);
  const data = JSON.parse(readFileSync(file, "utf8"));
  update(data);
  writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
};
json("packages/vite/package.json", (d) => (d.version = version));
json("packages/extension/manifest.json", (d) => (d.version = version));
json("packages/claude-plugin/.claude-plugin/plugin.json", (d) => (d.version = version));

const changelog = join(root, "CHANGELOG.md");
const text = readFileSync(changelog, "utf8");
if (!text.includes(`## [${version}]`)) {
  const today = new Date().toISOString().slice(0, 10);
  writeFileSync(changelog, text.replace("## [Unreleased]\n", `## [Unreleased]\n\n## [${version}] — ${today}\n`));
}
console.log(`version ${version}: packages/vite, extension manifest, plugin manifest, CHANGELOG`);
