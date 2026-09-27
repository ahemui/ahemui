import type { Point, Rect } from "./types.js";

const MAX_WIDTH = 1600;

/**
 * Crops `source` (which covers the viewport at `scale` px per CSS px, offset by `origin`) to `rect`,
 * draws freehand strokes on top, and encodes WebP small enough to fit `maxBytes`.
 */
export async function cropToDataUrl(
  source: CanvasImageSource,
  scale: number,
  rect: Rect,
  strokes: Point[][],
  maxBytes: number,
  origin: Point = [0, 0],
  masks: Rect[] = [],
): Promise<string> {
  let outScale = Math.min(scale, MAX_WIDTH / Math.max(rect.w, 1));
  for (let attempt = 0; attempt < 6; attempt++) {
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(rect.w * outScale));
    canvas.height = Math.max(1, Math.round(rect.h * outScale));
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(
      source,
      (rect.x - origin[0]) * scale,
      (rect.y - origin[1]) * scale,
      rect.w * scale,
      rect.h * scale,
      0,
      0,
      canvas.width,
      canvas.height,
    );
    drawMasks(ctx, masks, rect, outScale);
    drawStrokes(ctx, strokes, rect, outScale);
    for (const quality of [0.9, 0.75, 0.6]) {
      const url = canvas.toDataURL("image/webp", quality);
      if (dataUrlBytes(url) <= maxBytes) return url;
    }
    outScale *= 0.7;
  }
  throw new Error("screenshot too large even after downscaling");
}

/** Solid blocks over sensitive content (form fields, emails, numbers, anything marked private). */
function drawMasks(ctx: CanvasRenderingContext2D, masks: Rect[], rect: Rect, scale: number) {
  ctx.fillStyle = "#3a3d45";
  for (const m of masks) ctx.fillRect((m.x - rect.x) * scale, (m.y - rect.y) * scale, m.w * scale, m.h * scale);
}

function drawStrokes(ctx: CanvasRenderingContext2D, strokes: Point[][], rect: Rect, scale: number) {
  ctx.strokeStyle = "#ff2d55";
  ctx.lineWidth = Math.max(2, 3 * scale);
  ctx.lineCap = ctx.lineJoin = "round";
  for (const stroke of strokes) {
    ctx.beginPath();
    stroke.forEach(([x, y], i) => {
      const px = (x - rect.x) * scale;
      const py = (y - rect.y) * scale;
      i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
    });
    ctx.stroke();
  }
}

export function dataUrlBytes(url: string): number {
  const b64 = url.slice(url.indexOf(",") + 1);
  return Math.floor((b64.length * 3) / 4) - (b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0);
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("failed to load screenshot"));
    img.src = src;
  });
}
