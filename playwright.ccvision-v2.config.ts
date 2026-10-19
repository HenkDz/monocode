import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/browser", testMatch: ["ccvision-v2.spec.ts"], workers: 1, retries: 0,
  outputDir: "test-results/ccvision-v2", reporter: [["list"], ["json", { outputFile: "test-results/ccvision-v2.json" }]],
  use: { baseURL: "http://127.0.0.1:1494", trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: { command: "node node_modules/vite/bin/vite.js --config tests/browser/ccvision-v2.vite.config.ts --host 127.0.0.1 --port 1494 --strictPort",
    url: "http://127.0.0.1:1494/tests/browser/ccvision-v2.html", reuseExistingServer: false, timeout: 180000 },
});
