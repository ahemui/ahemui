import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { AhemStore } from "@ahemui/core";
import { installedBuild, ahemuiDependents } from "../src/update.js";

let root: string;
before(async () => {
  root = await mkdtemp(join(tmpdir(), "ahemui-upd-"));
  await AhemStore.init(root);
  await writeFile(join(root, "package.json"), JSON.stringify({ name: "root", devDependencies: { typescript: "5" } }));
  await mkdir(join(root, "apps", "web", "node_modules", "ahemui", "dist"), { recursive: true });
  await writeFile(join(root, "apps", "web", "package.json"), JSON.stringify({ devDependencies: { "ahemui": "file:../../.ahemui/vendor/ahemui.tgz" } }));
  await writeFile(join(root, "apps", "web", "node_modules", "ahemui", "dist", "index.js"), 'var BUILD = typeof "20260927061255" === "string" ? "20260927061255" : "dev";');
  await mkdir(join(root, "node_modules", "x"), { recursive: true });
  await writeFile(join(root, "node_modules", "x", "package.json"), JSON.stringify({ dependencies: { "ahemui": "1" } }));
});
after(() => rm(root, { recursive: true, force: true }));

test("finds the apps that use ahemui (monorepo aware, skips node_modules)", () => {
  assert.deepEqual(ahemuiDependents(root), [join(root, "apps", "web")]);
});

test("reads the installed build id", () => {
  assert.equal(installedBuild(join(root, "apps", "web")), "20260927061255");
  assert.equal(installedBuild(root), null);
});
