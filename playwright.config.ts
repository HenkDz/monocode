import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/browser",
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:1435",
    viewport: { width: 1000, height: 800 },
    trace: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    { name: "webkit", use: { browserName: "webkit" } },
  ],
  webServer: {
    command:
      "node node_modules/vite/bin/vite.js build --config tests/browser/vite.config.ts && node node_modules/vite/bin/vite.js preview --config tests/browser/vite.config.ts --host 127.0.0.1 --port 1435 --strictPort",
    url: "http://127.0.0.1:1435/tests/browser/mono-activity.html",
    timeout: 180_000,
    reuseExistingServer: false,
  },
});
