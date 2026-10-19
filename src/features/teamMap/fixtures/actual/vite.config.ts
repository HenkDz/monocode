import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { appMapHostSource } from "./appSource";

export default defineConfig({
  optimizeDeps: { entries: ["src/features/teamMap/fixtures/actual/index.html"] },
  plugins: [react(), tailwindcss(), {
    name: "actual-app-map-seams",
    resolveId(id: string) { if (id === "virtual:app-map-host") return id; },
    load(id: string) { if (id === "virtual:app-map-host") return `export default ${appMapHostSource()}`; },
  }],
});
