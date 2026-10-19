import { defineConfig } from "vite";
import projectConfig from "./vite.ccfb2.config";
import { readFileSync } from "node:fs";
import ts from "typescript";

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
        resolveId(id: string) {
          if (id === "virtual:ccfb3-reload-guard") return "\0" + id;
        },
        load(id: string) {
          if (id !== "\0virtual:ccfb3-reload-guard") return;
          const source = readFileSync(
            new URL("../../src/app/model/appLifecycle.ts", import.meta.url),
            "utf8",
          );
          const ast = ts.createSourceFile(
            "appLifecycle.ts",
            source,
            ts.ScriptTarget.Latest,
            true,
          );
          const guard = ast.statements.find(
            (node) =>
              ts.isFunctionDeclaration(node) &&
              node.name?.text === "confirmReload",
          );
          if (!guard) throw Error("Actual confirmReload guard missing");
          return ts.transpile(
            `import { ask } from "@tauri-apps/plugin-dialog";\n${guard.getText(ast)}`,
            { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext },
          );
        },
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
