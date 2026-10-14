import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/browser",
  testMatch: ["ccwb1-workbench.spec.ts", "cc7u-workbench.spec.ts", "ccwb1f-workbench.spec.ts"],
  workers: 1,
  outputDir: process.env.CCWB1_OUTPUT ?? "test-results/ccwb1",
  use: {
    baseURL: "http://127.0.0.1:1477",
    viewport: { width: 1440, height: 960 },
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: {
    command:
      "node node_modules/vite/bin/vite.js --config tests/browser/vite.config.ts --host 127.0.0.1 --port 1477 --strictPort",
    url: "http://127.0.0.1:1477/tests/browser/ccwb1-workbench.html",
    timeout: 180_000,
    reuseExistingServer: false,
  },
});
