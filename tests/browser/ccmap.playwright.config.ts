import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";
const port = Number(process.env.CCMAP_PORT ?? 1499);
export default defineConfig({ testDir: ".", testMatch: "ccmap.spec.ts", workers: 1, fullyParallel: false, retries: 0,
  outputDir: "../../target/ccmap-browser",
  use: { baseURL: `http://127.0.0.1:${port}`, browserName: "chromium", trace: "retain-on-failure" },
  reporter: [["list"], ["json"]],
  webServer: { cwd: fileURLToPath(new URL("../../", import.meta.url)), command: `node node_modules/vite/bin/vite.js --config tests/browser/ccmap.vite.config.ts --host 127.0.0.1 --port ${port} --strictPort`, url: `http://127.0.0.1:${port}/tests/browser/ccmap.html`, reuseExistingServer: false, timeout: 120000 },
});
