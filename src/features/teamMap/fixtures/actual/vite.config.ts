import { defineConfig } from "vite";
import projectConfig from "../../../../../vite.config";
import { appMapHostSource } from "./appSource";

export default defineConfig(async environment => {
  const config = await projectConfig(environment);
  return {
  ...config,
  optimizeDeps: { entries: ["src/features/teamMap/fixtures/actual/index.html"] },
  plugins: [...config.plugins, {
    name: "actual-app-map-seams",
    resolveId(id: string) { if (id === "virtual:app-map-host") return id; },
    load(id: string) { if (id === "virtual:app-map-host") return `export default ${appMapHostSource()}`; },
  }],
  };
});
