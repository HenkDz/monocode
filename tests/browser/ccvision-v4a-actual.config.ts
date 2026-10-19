import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";
export default defineConfig({
  testDir: ".", testMatch: "ccvision-v4a-actual.spec.ts", workers: 1,
  outputDir: "../../test-results/ccvision-v4a-actual",
  reporter: [["list"], ["json", { outputFile: fileURLToPath(new URL("../../test-results/ccvision-v4a-actual.json", import.meta.url)) }]],
  use: { baseURL: "http://127.0.0.1:1495", trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: { cwd: fileURLToPath(new URL("../..", import.meta.url)), command: "node node_modules/vite/bin/vite.js --config tests/browser/ccvision-v4a-actual.vite.config.ts --host 127.0.0.1 --port 1495 --strictPort", url: "http://127.0.0.1:1495/tests/browser/ccvision-v4a-actual.tsx", reuseExistingServer: false, timeout: 180000 },
});
