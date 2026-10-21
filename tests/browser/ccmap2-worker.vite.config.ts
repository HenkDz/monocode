import { defineConfig } from "vite";
import config from "./ccmap.vite.config";
import { workerAppPaths } from "./ccmap2WorkerPaths";
export default defineConfig({ ...config, optimizeDeps: { entries: ["tests/browser/ccmap2-worker.html", "tests/browser/ccmap.html"] }, plugins: [...config.plugins!, workerAppPaths()] });
