import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { readdirSync } from "node:fs";
import { defineConfig } from "vite";
import projectConfig from "../../vite.config";
import { ccgoalAppPaths } from "./ccgoalAppPaths";
import { ccwb1AppPaths } from "./ccwb1AppPaths";

const root = fileURLToPath(new URL("../../", import.meta.url));
const fixtures = fileURLToPath(new URL("./", import.meta.url));

export default defineConfig(async (environment) => {
  const config = await projectConfig(environment);
  return {
    ...config,
    plugins: [...(config.plugins ?? []), ccgoalAppPaths(), ccwb1AppPaths()],
    root,
    build: {
      ...config.build,
      outDir: resolve(root, "target/browser-fixtures"),
      emptyOutDir: true,
      rollupOptions: {
        input: readdirSync(fixtures)
          .filter((name) => name.endsWith(".html"))
          .map((name) => resolve(fixtures, name)),
      },
    },
  };
});
