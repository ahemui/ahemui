import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "@playwright/test";

const PORT = 5199;
// Personal settings go to a throwaway folder, never the developer's ~/.ahemui/prefs.json.
const home = mkdtempSync(join(tmpdir(), "ahemui-e2e-home-"));

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 1280, height: 900 },
    // CI installs Playwright's Chromium; locally, use a browser that's already there.
    ...(process.env.CI ? {} : { channel: process.platform === "win32" ? "msedge" : "chrome" }),
    trace: "retain-on-failure",
  },
  webServer: {
    command: `npm run dev -w ahemui-example-vue -- --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: { AHEMUI_HOME: home },
  },
});
