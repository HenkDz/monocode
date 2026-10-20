import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
const evidence = process.env.CCV2_EVIDENCE_DIR!;
const vite = fileURLToPath(new URL("../../../../../node_modules/vite/bin/vite.js", import.meta.url));
const config = fileURLToPath(new URL("./vite.config.ts", import.meta.url));
export default defineConfig({ testDir: fileURLToPath(new URL(".", import.meta.url)), testMatch: "decisions.browser.spec.ts", workers: 1,
  outputDir: join(evidence, "browser-artifacts"), reporter: [["list"], ["json", { outputFile: join(evidence, "browser-results.json") }]],
  use: { baseURL: "http://127.0.0.1:1489", viewport: { width: 1280, height: 1000 }, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: { command: `"${process.execPath}" "${vite}" --config "${config}" --host 127.0.0.1 --port 1489 --strictPort`, cwd: process.env.CCV2_LAUNCH_DIR, url: "http://127.0.0.1:1489", timeout: 60_000, reuseExistingServer: false },
});
