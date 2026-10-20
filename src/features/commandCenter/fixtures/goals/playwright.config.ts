import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
const evidence = process.env.CCUX1_GOALS_EVIDENCE!;
export default defineConfig({ testDir: fileURLToPath(new URL(".", import.meta.url)), testMatch: "goals.browser.spec.ts", workers: 1,
  outputDir: join(evidence, "artifacts"), reporter: [["list"], ["json", { outputFile: join(evidence, "results.json") }]],
  use: { baseURL: "http://127.0.0.1:1497", viewport: { width: 1280, height: 900 }, trace: "retain-on-failure" },
  webServer: { command: `"${process.execPath}" "${fileURLToPath(new URL("../../../../../node_modules/vite/bin/vite.js", import.meta.url))}" --config "${fileURLToPath(new URL("./vite.config.ts", import.meta.url))}"`,
    cwd: fileURLToPath(new URL("../../../../../", import.meta.url)), url: "http://127.0.0.1:1497", timeout: 60_000, reuseExistingServer: false } });
