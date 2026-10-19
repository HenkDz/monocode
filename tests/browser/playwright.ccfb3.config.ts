import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";

const evidence = process.env.CCFB3_RUN ?? "../../target/ccfb3-browser";
export default defineConfig({
  testDir: ".",
  testMatch: [
    "ccfb3-startup.spec.ts",
    "ccfb3-review.spec.cjs",
    "ccfb2-shell.spec.ts",
  ],
  grep: /startup|source-selected window chrome in dark regular/,
  workers: 1,
  retries: 0,
  timeout: 30_000,
  outputDir: `${evidence}/results`,
  reporter: [["list"], ["json", { outputFile: `${evidence}/results.json` }]],
  use: {
    baseURL: "http://127.0.0.1:1443",
    browserName: "chromium",
    viewport: { width: 1000, height: 720 },
    trace: "retain-on-failure",
  },
  webServer: {
    cwd: fileURLToPath(new URL("../../", import.meta.url)),
    command:
      "node node_modules/vite/bin/vite.js --config tests/browser/vite.ccfb3.config.ts --host 127.0.0.1 --port 1443 --strictPort",
    url: "http://127.0.0.1:1443",
    reuseExistingServer: false,
    timeout: 120_000,
    gracefulShutdown: { signal: "SIGTERM", timeout: 5000 },
  },
});
