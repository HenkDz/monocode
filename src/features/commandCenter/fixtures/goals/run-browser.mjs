import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
if (!process.argv[2]) throw Error("A durable evidence directory is required");
const evidence = resolve(process.argv[2]);
mkdirSync(evidence, { recursive: true });
const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toUpperCase() !== "CODEX_HOME" && !key.toUpperCase().startsWith("ORCA_")));
environment.NODE_OPTIONS = "--no-experimental-webstorage";
environment.CCUX1_GOALS_EVIDENCE = evidence;
const child = spawn(process.execPath, [fileURLToPath(new URL("../../../../../node_modules/@playwright/test/cli.js", import.meta.url)), "test", "--config", fileURLToPath(new URL("./playwright.config.ts", import.meta.url))],
  { cwd: evidence, env: environment, windowsHide: true, stdio: "inherit" });
child.on("error", error => { console.error(error); process.exitCode = 1; });
child.on("close", exitCode => {
  writeFileSync(join(evidence, "launch.json"), JSON.stringify({ exitCode, fixture: "Actual goal selectors, click guard, decision adapter, ProjectDrawer and policy components; synthetic callback ports; Start disconnected; not App/native/provider acceptance" }, null, 2));
  process.exitCode = exitCode ?? 1;
});
