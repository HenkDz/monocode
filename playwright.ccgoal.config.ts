import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

export default defineConfig({
  ...base,
  testMatch: "ccgoal-authorized-work.spec.ts",
  outputDir: "target/ccgoal-browser",
  workers: 1,
  use: { ...base.use, baseURL: "http://127.0.0.1:14431" },
  webServer: {
    command: "node node_modules/vite/bin/vite.js build --config tests/browser/vite.config.ts && node node_modules/vite/bin/vite.js preview --config tests/browser/vite.config.ts --host 127.0.0.1 --port 14431 --strictPort",
    url: "http://127.0.0.1:14431/tests/browser/ccgoal-authorized-work.html",
    timeout: 180_000,
    reuseExistingServer: false,
  },
});
