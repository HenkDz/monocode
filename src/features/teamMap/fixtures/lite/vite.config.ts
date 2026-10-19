import { defineConfig } from "vite";
import projectConfig from "../../../../../vite.config";
export default defineConfig(async environment => ({
  ...await projectConfig(environment),
  optimizeDeps: { entries: ["src/features/teamMap/fixtures/lite/index.html"] },
}));
