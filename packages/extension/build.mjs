import { build } from "esbuild";
import { buildDefine } from "../../scripts/build-id.mjs";
import { copyFile, mkdir, rm, writeFile } from "node:fs/promises";
import { deflateSync } from "node:zlib";

await rm("dist", { recursive: true, force: true });
await mkdir("dist/icons", { recursive: true });
await build({
  entryPoints: {
    background: "src/background.ts",
    overlay: "src/overlay-entry.ts",
    "page-agent": "src/page-agent.ts",
    popup: "src/popup.ts",
  },
  outdir: "dist",
  bundle: true,
  format: "iife",
  target: "chrome111",
  define: buildDefine(),
  minify: true,
  legalComments: "none",
  logLevel: "warning",
});
await copyFile("manifest.json", "dist/manifest.json");
await copyFile("popup.html", "dist/popup.html");
for (const size of [16, 32, 48, 128]) await writeFile(`dist/icons/${size}.png`, icon(size));
console.log("extension built → packages/extension/dist (load unpacked)");

/** Violet disc with a white pen-dot, rendered straight to PNG so the build needs no image tooling. */
function icon(size) {
  const px = Buffer.alloc(size * size * 4);
  const c = (size - 1) / 2;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - c, y - c) / (size / 2);
      const i = (y * size + x) * 4;
      const inner = Math.hypot(x - c * 1.25, y - c * 0.75) / (size / 2);
      const white = inner < 0.22 || (d > 0.62 && d < 0.74);
      const a = Math.max(0, Math.min(1, (1 - d) * size * 0.5));
      px.set(white ? [255, 255, 255] : [232, 105, 79], i);
      px[i + 3] = Math.round(a * 255);
    }
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function crc32(buf) {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}
