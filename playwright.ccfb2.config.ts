import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/browser",
  testMatch: ["ccfb2-usage.spec.ts", "ccfb2-shell.spec.ts"],
  workers: 1,
  outputDir: process.env.CCFB2_OUTPUT ?? "test-results/ccfb2",
  use: {
    baseURL: "http://127.0.0.1:1485",
    viewport: { width: 960, height: 720 },
    trace: "retain-on-failure",
    browserName: "chromium",
  },
  webServer: {
    command: "node node_modules/vite/bin/vite.js --config tests/browser/vite.ccfb2.config.ts --host 127.0.0.1 --port 1485 --strictPort",
    url: "http://127.0.0.1:1485/tests/browser/ccfb2-usage.html",
    timeout: 180_000,
    reuseExistingServer: false,
  },
});
