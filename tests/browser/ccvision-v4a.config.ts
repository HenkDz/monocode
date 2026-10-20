import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";
export default defineConfig({
  testDir: ".", testMatch: "ccvision-v4a.spec.ts", workers: 1,
  outputDir: "../../test-results/ccvision-v4a", reporter: [["list"], ["json", { outputFile: fileURLToPath(new URL("../../test-results/ccvision-v4a.json", import.meta.url)) }]],
  use: { baseURL: "http://127.0.0.1:1494", trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: { cwd: fileURLToPath(new URL("../..", import.meta.url)), command: "node node_modules/vite/bin/vite.js --config tests/browser/ccvision-v4a.vite.config.ts --host 127.0.0.1 --port 1494 --strictPort", url: "http://127.0.0.1:1494/tests/browser/ccvision-v4a.html", reuseExistingServer: false, timeout: 60000 },
});
