import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { SnapStore } from "@snap/core";
import { installedBuild, snapDependents } from "../src/update.js";

let root: string;
before(async () => {
  root = await mkdtemp(join(tmpdir(), "snap-upd-"));
  await SnapStore.init(root);
  await writeFile(join(root, "package.json"), JSON.stringify({ name: "root", devDependencies: { typescript: "5" } }));
  await mkdir(join(root, "apps", "web", "node_modules", "@snap", "vite", "dist"), { recursive: true });
  await writeFile(join(root, "apps", "web", "package.json"), JSON.stringify({ devDependencies: { "@snap/vite": "file:../../.snap/vendor/snap-vite.tgz" } }));
  await writeFile(join(root, "apps", "web", "node_modules", "@snap", "vite", "dist", "index.js"), 'var BUILD = typeof "20260927061255" === "string" ? "20260927061255" : "dev";');
  await mkdir(join(root, "node_modules", "x"), { recursive: true });
  await writeFile(join(root, "node_modules", "x", "package.json"), JSON.stringify({ dependencies: { "@snap/vite": "1" } }));
});
after(() => rm(root, { recursive: true, force: true }));

test("finds the apps that use @snap/vite (monorepo aware, skips node_modules)", () => {
  assert.deepEqual(snapDependents(root), [join(root, "apps", "web")]);
});

test("reads the installed build id", () => {
  assert.equal(installedBuild(join(root, "apps", "web")), "20260927061255");
  assert.equal(installedBuild(root), null);
});
