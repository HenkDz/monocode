import { defineConfig } from "@playwright/test";
const run = Date.now();
export default defineConfig({
  testDir: "./tests/browser", testMatch: "ccfb5.spec.ts", workers: 1, retries: 0,
  outputDir: `../cc-program/ccfeedback5/browser-results-${run}`,
  reporter: [["list"], ["json", { outputFile: `../cc-program/ccfeedback5/browser-${run}.json` }]],
  use: { baseURL: "http://127.0.0.1:1495", trace: "retain-on-failure", reducedMotion: "reduce" },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: {
    command: "node node_modules/vite/bin/vite.js --config tests/browser/ccfb5.vite.config.ts --host 127.0.0.1 --port 1495 --strictPort",
    url: "http://127.0.0.1:1495/tests/browser/ccfb5.html", reuseExistingServer: false, timeout: 120000,
  },
});
