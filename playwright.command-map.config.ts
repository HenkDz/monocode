import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/browser", testMatch: "command-map.spec.ts", workers: 1,
  outputDir: "../cc-program/ccvision/v3-independent/browser-results",
  reporter: [["list"], ["json", { outputFile: "../cc-program/ccvision/v3-independent/browser.json" }]],
  use: { baseURL: "http://127.0.0.1:1493", trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: {
    command: "node node_modules/vite/bin/vite.js --config tests/browser/command-map.vite.config.ts --host 127.0.0.1 --port 1493 --strictPort",
    url: "http://127.0.0.1:1493/tests/browser/command-map.html", reuseExistingServer: false, timeout: 120000,
  },
});
