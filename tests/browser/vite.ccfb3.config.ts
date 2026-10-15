import { defineConfig } from "vite";
import projectConfig from "./vite.ccfb2.config";

/** Use the real entry/HTML/controller, replacing only workspace and native boot dependencies. */
export default defineConfig(async (environment) => {
  const config = await projectConfig(environment);
  return {
    ...config,
    plugins: [
      ...(config.plugins ?? []),
      {
        name: "ccfb3-synthetic-boot",
        enforce: "pre" as const,
        transform(source: string, id: string) {
          if (!id.replaceAll("\\", "/").endsWith("/src/main.tsx")) return;
          let code = source.replace(
            'import("./app/App")',
            'import("/tests/browser/ccfb3-app.tsx")',
          );
          for (const path of [
            "./app/model/appLifecycle",
            "./features/settings/model/sounds",
            "./platform/tauri/fs",
            "./shared/lib/paths",
            "./app/model/updateNotice",
            "./features/providers/model/providerBinaryPaths",
            "./features/connections/model/remoteCommands",
          ]) {
            code = code.replaceAll(
              `"${path}"`,
              '"/tests/browser/ccfb3-native.ts"',
            );
          }
          return `import "/tests/browser/ccfb3-native.ts";\n${code}`;
        },
      },
    ],
  };
});
