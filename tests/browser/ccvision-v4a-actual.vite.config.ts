import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { actualIntegrationAppSource } from "./ccvision-v4a-actualAppSource";
export default defineConfig({
  cacheDir: "node_modules/.vite-ccvision-v4a-actual",
  optimizeDeps: { entries: ["tests/browser/ccvision-v4a-actual.html"] },
  server: { watch: { ignored: ["**/src-tauri/**", "**/target/**", "**/target-v4a/**"] } },
  plugins: [react(), tailwindcss(), { name: "actual-v4a-app-seams",
    resolveId(id) { if (id === "virtual:actual-integration-app") return id; },
    load(id) { if (id === "virtual:actual-integration-app") return `export default ${actualIntegrationAppSource()}`; },
  }],
});
