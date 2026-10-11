import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  plugins: [react(), tailwindcss()],
  cacheDir: process.env.CC7E_VITE_CACHE,
  server: { host: "127.0.0.1", port: 0, strictPort: true },
});
