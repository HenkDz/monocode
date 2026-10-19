import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
const evidence = process.env.CCV2_EVIDENCE_DIR;
if (!evidence) throw Error("CCV2_EVIDENCE_DIR is required");
mkdirSync(evidence, { recursive: true });
const launchDirectory = mkdtempSync(join(tmpdir(), "monocode-v2lite-browser-"));
const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toUpperCase() !== "CODEX_HOME" && !key.toUpperCase().startsWith("ORCA_")));
environment.NODE_OPTIONS = "--no-experimental-webstorage";
environment.CCV2_LAUNCH_DIR = launchDirectory;
const child = spawn(process.execPath, [fileURLToPath(new URL("../../../../../node_modules/@playwright/test/cli.js", import.meta.url)), "test", "--config", fileURLToPath(new URL("./playwright.config.ts", import.meta.url))], { cwd: launchDirectory, env: environment, windowsHide: true, stdio: "inherit" });
child.on("error", error => { console.error(error); process.exitCode = 1; });
child.on("close", exitCode => {
  writeFileSync(join(evidence, "browser-launch.json"), JSON.stringify({ exitCode, launchDirectory, fixture: "V2-lite production cards/ledger/click adapter/queue helpers; synthetic sessions and injected storage/send port, no full App/native/provider acceptance", realProfileWrites: 0, liveModelTurns: 0, persistentContexts: 0, orcaVariablesUnset: !Object.keys(environment).some(key => key.toUpperCase().startsWith("ORCA_")), codexHomeUnset: !("CODEX_HOME" in environment) }, null, 2));
  process.exitCode = exitCode ?? 1;
});
