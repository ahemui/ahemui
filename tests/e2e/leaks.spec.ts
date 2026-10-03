// Leak check for the in-page overlay: run its main flows many times and compare event listeners, JS heap and the
// DOM actually in the page before and after (after forced GCs). Slow, so opt-in:
//   AHEMUI_LEAKS=1 npx playwright test leaks
//
// Chromium's own "Nodes"/"Documents" counters are logged too but not asserted: every Vite-overlay capture renders
// the page through modern-screenshot, which parses CSS in a throwaway document that Blink keeps alive internally
// (held by its ScriptRunner, not by any JavaScript object), about one empty document per capture. The extension's
// captures use real tab screenshots and don't do this.
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";

const made: string[] = [];
test.afterAll(async () => {
  for (const id of made) {
    for (const loc of ["items", "done"]) await rm(join("examples", "vue-app", ".ahemui", loc, id), { recursive: true, force: true });
  }
});

const server = (page: Page) => page.evaluate(() => (window as any).__AHEMUI__?.server as string);

test("the overlay doesn't grow its listeners, heap or DOM with use", async ({ page }) => {
  test.skip(!process.env.AHEMUI_LEAKS, "set AHEMUI_LEAKS=1 to run");
  test.setTimeout(300_000);
  await page.goto("/");
  await expect(page.locator("ahemui-overlay .bar .dot.ok")).toBeAttached();
  const base = await server(page);
  const post = async (path: string, body: unknown) =>
    (await page.request.post(base + path, { data: body, headers: { "Content-Type": "application/json" } })).json();

  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Performance.enable");
  const measure = async () => {
    for (let i = 0; i < 4; i++) {
      await cdp.send("HeapProfiler.collectGarbage");
      await page.waitForTimeout(250);
    }
    const { metrics } = await cdp.send("Performance.getMetrics");
    const m = Object.fromEntries(metrics.map((x) => [x.name, x.value]));
    const attached = await page.evaluate(
      () => document.querySelectorAll("*").length + (document.querySelector("ahemui-overlay")?.shadowRoot?.querySelectorAll("*").length ?? 0),
    );
    return { listeners: m.JSEventListeners, heapMB: m.JSHeapUsedSize / 1_048_576, attached, nodes: m.Nodes, docs: m.Documents };
  };

  const steps = (process.env.AHEMUI_LEAKS_STEPS ?? "marker,panel,status,capture").split(",");
  const cycle = async (n: number) => {
    // A new item arrives over the live connection, gets a marker, and its popover opens and closes.
    const markers = page.locator("ahemui-overlay .marker");
    const had = await markers.count();
    const item = await post("/api/items", { prompt: `leak check ${n}`, route: "/", anchor: { text: "Ship interfaces faster" } });
    made.push(item.id);
    await expect(markers).toHaveCount(had + 1);
    if (steps.includes("marker")) {
      await markers.last().click();
      await expect(page.locator("ahemui-overlay .pop")).toBeVisible();
      await page.keyboard.press("Escape");
    }
    if (steps.includes("panel")) {
      await page.locator("ahemui-overlay .counts").click();
      await page.locator("ahemui-overlay [data-settings]").click();
      await page.keyboard.press("Escape");
    }
    if (steps.includes("status")) {
      await page.locator("ahemui-overlay .state").click();
      await page.keyboard.press("Escape");
    }
    if (steps.includes("capture")) {
      await page.waitForTimeout(450); // the shortcut ignores a second press within 400 ms
      await page.keyboard.press("Alt+Shift+S");
      const h = (await page.getByRole("heading", { name: "Ship interfaces faster" }).boundingBox())!;
      await page.mouse.click(h.x + h.width / 2, h.y + h.height / 2);
      await expect(page.locator("ahemui-overlay .bubble")).toBeVisible();
      await page.locator("ahemui-overlay .b-close").click();
      await page.keyboard.press("Escape");
    }
    // The item leaves again (dismissed), so its marker goes.
    await post(`/api/items/${item.id}/dismiss`, {});
    await expect(markers).toHaveCount(had);
  };

  for (let i = 0; i < 3; i++) await cycle(i); // warm up caches and lazy code
  const before = await measure();
  const cycles = Number(process.env.AHEMUI_LEAKS_CYCLES ?? 30);
  for (let i = 3; i < 3 + cycles; i++) await cycle(i);
  const after = await measure();
  console.log(
    `${cycles} cycles — listeners ${before.listeners} → ${after.listeners}, heap ${before.heapMB.toFixed(1)} → ${after.heapMB.toFixed(1)} MB, ` +
      `attached DOM ${before.attached} → ${after.attached} (Chromium nodes ${before.nodes} → ${after.nodes}, documents ${before.docs} → ${after.docs})`,
  );

  expect(after.listeners - before.listeners).toBeLessThan(10);
  expect(after.attached - before.attached).toBeLessThan(10);
  expect(after.heapMB - before.heapMB).toBeLessThan(2);
});
