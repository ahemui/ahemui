import vue from "@vitejs/plugin-vue";
import ahemui from "ahemui";
import { defineConfig } from "vite";

// A deliberately broken API, so the example has a real failed request for AhemUI to capture.
const brokenApi = {
  name: "broken-api",
  configureServer(server) {
    server.middlewares.use("/api", (_req, res) => {
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: "stats service unavailable" }));
    });
  },
};

export default defineConfig({
  plugins: [vue(), ahemui(), brokenApi],
});
