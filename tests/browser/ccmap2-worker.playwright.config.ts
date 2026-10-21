import { defineConfig } from "@playwright/test";
import base from "./ccmap.playwright.config";
const port = Number(process.env.CCMAP_PORT ?? 1499);
export default defineConfig({ ...base, testMatch: ["ccmap2-worker.spec.ts", "ccmap2-responsive.spec.ts"], outputDir: process.env.CCMAP_OUTPUT ?? "../../target/ccmap2-worker",
  webServer: { ...base.webServer, command: `node node_modules/vite/bin/vite.js --config tests/browser/ccmap2-worker.vite.config.ts --host 127.0.0.1 --port ${port} --strictPort` },
});
