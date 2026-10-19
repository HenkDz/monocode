import { defineConfig } from "vite";
import projectConfig from "../../vite.config";
import { decisionAppSource } from "../decisionAppSource";

export default defineConfig(async environment => {
  const config = await projectConfig(environment);
  return { ...config, optimizeDeps: { entries: ["tests/browser/ccvision-v2.html", "tests/browser/ccvision-v2-continuation.html"] }, plugins: [...(config.plugins ?? []), {
    name: "actual-app-decision-seams",
    resolveId(id: string) { if (id === "virtual:ccvision-v2-app") return "\0ccvision-v2-app"; },
    load(id: string) { if (id === "\0ccvision-v2-app") return `export default ${JSON.stringify(decisionAppSource())}`; },
  }] };
});
