import { defineConfig } from "@playwright/test";
import original from "./ccmap.playwright.config";
export default defineConfig({ ...original, testMatch: ["ccmap.spec.ts", "ccmap2.spec.ts"],
  outputDir: process.env.CCMAP_OUTPUT,
});
