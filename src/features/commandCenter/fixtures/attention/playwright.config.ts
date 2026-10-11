import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const evidence = process.env.CC7D_EVIDENCE_DIR ?? "C:/Users/nooro/AppData/Local/Temp/monocode-cc/cc7d/evidence";
const vite = fileURLToPath(new URL("../../../../../node_modules/vite/bin/vite.js", import.meta.url));
const config = fileURLToPath(new URL("./vite.config.ts", import.meta.url));

export default defineConfig({
  testDir: fileURLToPath(new URL(".", import.meta.url)), testMatch: "attention.browser.spec.ts", workers: 1,
  outputDir: join(evidence, "browser-artifacts"),
  reporter: [["list"], ["json", { outputFile: join(evidence, "browser-results.json") }]],
  use: { baseURL: "http://127.0.0.1:1478", viewport: { width: 1440, height: 1000 }, trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: {
    command: `"${process.execPath}" "${vite}" --config "${config}" --host 127.0.0.1 --port 1478 --strictPort`,
    cwd: process.env.CC7D_LAUNCH_DIR,
    url: "http://127.0.0.1:1478", timeout: 60_000, reuseExistingServer: false,
  },
});
