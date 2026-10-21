import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import actualConfig from "../../src/features/teamMap/fixtures/actual/vite.config";

export default defineConfig({ ...actualConfig, optimizeDeps: { entries: ["tests/browser/ccmap.html"] }, plugins: [...actualConfig.plugins!, {
  name: "ccmap-frozen-prototype",
  configureServer(server) {
    server.middlewares.use((request, response, next) => {
      if (request.url !== "/__ccmap_prototype") { next(); return; }
      response.setHeader("Content-Type", "text/html; charset=utf-8");
      response.end(readFileSync("../cc-program/ccmap/APPROVED-PROTOTYPE.html", "utf8"));
    });
  },
}] });
