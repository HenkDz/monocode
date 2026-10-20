import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/browser", testMatch: ["ccux1-a8.spec.ts"], workers: 1,
  timeout: 30000, globalSetup: "./tests/browser/ccux1-a8.warmup.ts",
  outputDir: process.env.A8_BASELINE ? "test-results/ccux1-a8-baseline" : "test-results/ccux1-a8", reporter: [["list"], ["json", { outputFile: process.env.A8_BASELINE ? "test-results/ccux1-a8-baseline.json" : "test-results/ccux1-a8.json" }]],
  use: { baseURL: "http://127.0.0.1:1498", trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: { command: "node node_modules/vite/bin/vite.js --config tests/browser/ccux1-a8.vite.config.ts --host 127.0.0.1 --port 1498 --strictPort", url: "http://127.0.0.1:1498/tests/browser/ccux1-a8.html", reuseExistingServer: false, timeout: 180000 },
});
