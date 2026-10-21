import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";
export default defineConfig({ testDir: ".", testMatch: "ccmap.spec.ts", workers: 1, fullyParallel: false, retries: 0,
  outputDir: "../../target/ccmap-browser",
  use: { baseURL: "http://127.0.0.1:1499", browserName: "chromium", trace: "retain-on-failure" },
  reporter: [["list"], ["json"]],
  webServer: { cwd: fileURLToPath(new URL("../../", import.meta.url)), command: "node node_modules/vite/bin/vite.js --config tests/browser/ccmap.vite.config.ts --host 127.0.0.1 --port 1499 --strictPort", url: "http://127.0.0.1:1499/tests/browser/ccmap.html", reuseExistingServer: false, timeout: 120000 },
});
