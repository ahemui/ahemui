// The whole loop in a real browser against examples/vue-app: capture → Start now → Claude resolves → approve.
// Claude's side goes through the same HTTP API the MCP tools and CLI use.
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";

const created: string[] = [];
test.afterAll(async () => {
  // Items in the example are gitignored; remove only the ones this test made.
  for (const id of created) await rm(join("examples", "vue-app", ".ahemui", "items", id), { recursive: true, force: true });
});

const server = (page: Page) => page.evaluate(() => (window as any).__AHEMUI__?.server as string);
const api = async (page: Page, path: string, init?: { method?: string; body?: unknown }) => {
  const res = await page.request.fetch((await server(page)) + path, {
    method: init?.method ?? "GET",
    data: init?.body,
    headers: { "Content-Type": "application/json" },
  });
  expect(res.ok(), `${init?.method ?? "GET"} ${path}`).toBeTruthy();
  return res.json();
};

test("capture, start now, review and approve", async ({ page }) => {
  await page.goto("/");
  const bar = page.locator("ahemui-overlay .bar");
  await expect(bar).toBeVisible();
  await expect(page.locator("ahemui-overlay .bar .dot.ok")).toBeAttached(); // connected to ahemui serve

  // Capture: toggle, click the headline, write the request.
  await page.keyboard.press("Alt+Shift+S");
  await expect(page.locator("ahemui-overlay .layer.active")).toBeAttached();
  const headline = page.getByRole("heading", { name: "Ship interfaces faster" });
  const box = (await headline.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  const bubble = page.locator("ahemui-overlay .bubble");
  await expect(bubble).toBeVisible();
  await expect(bubble.locator(".where")).toContainText("HomePage");

  // First note of the sitting: no batch, to keep the example repo clean.
  await bubble.locator(".bp-target").selectOption("none");
  await bubble.locator("textarea").fill("Make the headline shorter");
  await bubble.locator("textarea").press("Enter");
  await expect(bubble).toBeHidden();

  // The item landed in .ahemui/ with its anchor, screenshot and the Start now flag.
  const items = await api(page, "/api/items");
  const item = items.find((i: any) => i.body.startsWith("Make the headline shorter"));
  expect(item, "item created").toBeTruthy();
  created.push(item.id);
  expect(item.start).toBe("now");
  expect(item.anchor.source).toMatch(/HomePage\.vue:\d+/);
  expect(item.shot).toBeTruthy();
  await page.keyboard.press("Escape"); // leave capture mode

  // Claude's side: claim and resolve to review.
  await api(page, `/api/items/${item.id}/resolve`, { method: "POST", body: { status: "review", note: "Shortened it." } });

  // The marker turns to review; its popover shows the before/after and approving closes it.
  const marker = page.locator("ahemui-overlay .marker.review");
  await expect(marker).toBeVisible();
  await marker.click();
  const pop = page.locator("ahemui-overlay .pop");
  await expect(pop.locator(".pill")).toHaveText(/ready for review/i);
  await expect(pop.locator(".request")).toHaveText("Make the headline shorter");
  await pop.getByRole("button", { name: /looks good/i }).click();
  await expect.poll(async () => (await api(page, `/api/items/${item.id}`)).status).toBe("done");
  await expect(page.locator("ahemui-overlay .marker.done")).toBeVisible();
});

test("a flag-for-review batch never offers Start now", async ({ page }) => {
  await page.goto("/pricing");
  await expect(page.locator("ahemui-overlay .bar .dot.ok")).toBeAttached();
  await page.locator("ahemui-overlay .capture").click();
  const heading = page.locator("main h1, main h2").first();
  const box = (await heading.boundingBox())!;
  await page.mouse.click(box.x + 10, box.y + box.height / 2);
  const bubble = page.locator("ahemui-overlay .bubble");
  await expect(bubble).toBeVisible();
  await bubble.getByRole("button", { name: "For review" }).click();
  await expect(bubble.locator(".start")).toBeHidden();
  await expect(bubble.locator(".submit")).toHaveText("Flag for review");
  await bubble.locator(".b-close").click();
});

test("capture with the keyboard alone: arrows move the highlight, Enter picks", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("ahemui-overlay .bar .dot.ok")).toBeAttached();
  await page.keyboard.press("Alt+Shift+S");
  await page.keyboard.press("Tab");
  await expect(page.locator("ahemui-overlay .hover")).toBeVisible();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  const bubble = page.locator("ahemui-overlay .bubble");
  await expect(bubble).toBeVisible();
  await expect(bubble.locator("textarea")).toBeFocused();
  await bubble.locator(".b-close").click();
});

test("the capture shortcut can be changed in settings", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("ahemui-overlay .bar .dot.ok")).toBeAttached();
  await page.locator("ahemui-overlay .counts").click();
  await page.locator("ahemui-overlay [data-settings]").click();
  await page.locator("ahemui-overlay .shortcut-change").click();
  await page.keyboard.press("Control+Shift+KeyY");
  await expect(page.locator("ahemui-overlay .shortcut-key")).toHaveText("Ctrl+Shift+Y");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Control+Shift+KeyY");
  await expect(page.locator("ahemui-overlay .layer.active")).toBeAttached();
  await page.keyboard.press("Escape");
  // Put it back (settings live in the test's throwaway AHEMUI_HOME, but keep the next test on the default).
  await page.locator("ahemui-overlay .counts").click();
  await page.locator("ahemui-overlay [data-settings]").click();
  await page.locator("ahemui-overlay .shortcut-reset").click();
});

test("dismiss an item from the backlog, then undo", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("ahemui-overlay .bar .dot.ok")).toBeAttached();
  const item = await api(page, "/api/items", { method: "POST", body: { prompt: "Throwaway idea", route: "/", anchor: { text: "Ship interfaces faster" } } });
  created.push(item.id);
  await page.locator("ahemui-overlay .counts").click();
  const row = page.locator(`ahemui-overlay .list-item[data-id="${item.id}"]`);
  await row.hover();
  const before = (await row.boundingBox())!.height;
  await row.locator(".row-dismiss").click();
  const strip = row.locator(".row-confirm");
  await expect(strip).toBeVisible(); // asks first; the row keeps its size
  expect((await row.boundingBox())!.height).toBe(before);
  expect((await api(page, `/api/items/${item.id}`)).location).toBe("items");
  await strip.getByRole("button", { name: "Cancel" }).click();
  await expect(strip).toHaveCount(0);
  await row.hover();
  await row.locator(".row-dismiss").click();
  await row.locator(".row-confirm").getByRole("button", { name: "Dismiss" }).click();
  await expect(row).toHaveCount(0);
  expect((await api(page, `/api/items/${item.id}`)).location).toBe("done");
  await page.locator("ahemui-overlay .toast-undo").click();
  await expect.poll(async () => (await api(page, `/api/items/${item.id}`)).location).toBe("items");
  // Clean up the archived copy too.
  await rm(join("examples", "vue-app", ".ahemui", "done", item.id), { recursive: true, force: true });
});

test("board: drag a card from Backlog to Queue; the modal keeps actions in its footer", async ({ page }) => {
  await page.goto("/");
  const base = await server(page);
  const item = await api(page, "/api/items", { method: "POST", body: { prompt: "Drag me to the queue", route: "/", anchor: {} } });
  created.push(item.id);
  await page.goto(`${base}/`);
  const card = page.locator(`.card[data-id="${item.id}"]`);
  await expect(page.locator(".col-backlog").locator(card)).toBeVisible();
  await card.dragTo(page.locator(".col-queue .cards"));
  await expect.poll(async () => (await (await page.request.get(`${base}/api/items/${item.id}`)).json()).start).toBe("now");
  await expect(page.locator(".col-queue").locator(card)).toBeVisible();

  await card.click();
  const modal = page.locator(".drawer");
  await expect(modal.locator(".d-status")).toContainText("Queued for Claude");
  await expect(modal.locator(".d-foot").getByRole("button", { name: "Move to backlog" })).toBeVisible();
  await expect(modal.locator(".d-body button.btn")).toHaveCount(0); // no action buttons mixed into the content
});
