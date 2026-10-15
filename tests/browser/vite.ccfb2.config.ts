import { defineConfig } from "vite";
import projectConfig from "../../vite.config";
import { ccfb2ShellPaths } from "./ccfb2ShellPaths";

export default defineConfig(async environment => {
  const config = await projectConfig(environment);
  return { ...config, plugins: [...(config.plugins ?? []), ccfb2ShellPaths()] };
});
