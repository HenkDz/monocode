import { defineConfig } from "vite";
import projectConfig from "../../vite.config";
export default defineConfig(async environment => ({
  ...await projectConfig(environment),
  optimizeDeps: { entries: ["tests/browser/command-map.html"] },
}));
