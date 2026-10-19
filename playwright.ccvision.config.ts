import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/browser",
  testMatch: ["ccvision-workspace.spec.ts"],
  workers: 1,
  outputDir: process.env.CCVISION_OUTPUT ?? "test-results/ccvision",
  reporter: [
    ["list"],
    [
      "json",
      {
        outputFile: `${process.env.CCVISION_OUTPUT ?? "test-results/ccvision"}.json`,
      },
    ],
  ],
  use: { baseURL: "http://127.0.0.1:1491", trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: {
    command:
      "node node_modules/vite/bin/vite.js --config tests/browser/ccvision.vite.config.ts --host 127.0.0.1 --port 1491 --strictPort",
    url: "http://127.0.0.1:1491/tests/browser/ccvision-workspace.tsx",
    reuseExistingServer: false,
    timeout: 180000,
  },
});
