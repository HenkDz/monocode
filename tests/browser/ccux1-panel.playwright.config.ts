import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";
export default defineConfig({
  testDir: ".", testMatch: "ccux1-panel.spec.ts", workers: 1,
  outputDir: "../../target/ccux1-panel",
  use: { baseURL: "http://127.0.0.1:1497", browserName: "chromium", trace: "retain-on-failure" },
  reporter: [["list"], ["json", { outputFile: fileURLToPath(new URL("../../../cc-program/ccux1/part-c/browser-result.json", import.meta.url)) }]],
  webServer: { cwd: fileURLToPath(new URL("../../", import.meta.url)), command: "node node_modules/vite/bin/vite.js --config tests/browser/ccux1-panel.vite.config.ts --host 127.0.0.1 --port 1497 --strictPort", url: "http://127.0.0.1:1497/tests/browser/ccux1-panel.html", reuseExistingServer: false, timeout: 120000 },
});
