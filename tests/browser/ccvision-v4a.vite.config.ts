import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  cacheDir: "test-results/ccvision-v4a-vite-cache",
  optimizeDeps: { entries: ["tests/browser/ccvision-v4a.html"] },
  server: { watch: { ignored: ["**/src-tauri/**", "**/target/**", "**/target-v4a/**"] } },
});
