import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";

export default defineConfig({
  testDir: ".", testMatch: "ccux1-ui.spec.ts", workers: 1,
  outputDir: "../../target/ccux1-ui-playwright",
  use: { baseURL: "http://127.0.0.1:1496", browserName: "chromium", trace: "retain-on-failure" },
  webServer: {
    cwd: fileURLToPath(new URL("../../", import.meta.url)),
    command: "node node_modules/vite/bin/vite.js --config tests/browser/ccux1-ui.vite.config.ts --host 127.0.0.1 --port 1496 --strictPort",
    url: "http://127.0.0.1:1496/tests/browser/ccux1-ui.html", reuseExistingServer: false, timeout: 120_000,
  },
});
