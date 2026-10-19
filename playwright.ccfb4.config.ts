import { defineConfig } from "@playwright/test";
import workbench from "./playwright.ccwb1.config";

export default defineConfig({
  ...workbench,
  testMatch: ["ccfb4-drawers.spec.ts"],
  outputDir: "test-results/ccfb4",
  use: { ...workbench.use, baseURL: "http://127.0.0.1:1484" },
  webServer: {
    ...workbench.webServer,
    command: "node node_modules/vite/bin/vite.js --config tests/browser/vite.config.ts --host 127.0.0.1 --port 1484 --strictPort",
    url: "http://127.0.0.1:1484/tests/browser/cc7u-workbench.html",
  },
});
