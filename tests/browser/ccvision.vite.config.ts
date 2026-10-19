import { defineConfig } from "vite";
import projectConfig from "../../vite.config";
import { ccvisionAppPaths } from "./ccvisionAppPaths";

export default defineConfig(async (environment) => {
  const config = await projectConfig(environment);
  return { ...config, plugins: [...(config.plugins ?? []), ccvisionAppPaths()], optimizeDeps: { entries: ["tests/browser/ccvision-workspace.html"] } };
});
