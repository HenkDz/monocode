import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";
export default defineConfig({
  testDir: ".", testMatch: "ccux2.spec.ts", workers: 1,
  outputDir: "../../target/ccux2-browser",
  use: { baseURL: "http://127.0.0.1:1498", browserName: "chromium", trace: "retain-on-failure" },
  reporter: [["list"], ["json", { outputFile: fileURLToPath(new URL("../../../cc-program/ccux2/evidence/browser-result.json", import.meta.url)) }]],
  webServer: { cwd: fileURLToPath(new URL("../../", import.meta.url)), command: "node node_modules/vite/bin/vite.js --config tests/browser/ccux2.vite.config.ts --host 127.0.0.1 --port 1498 --strictPort", url: "http://127.0.0.1:1498/tests/browser/ccux2.html", reuseExistingServer: false, timeout: 120000 },
});
