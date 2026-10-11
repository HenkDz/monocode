import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const evidence = process.env.CC7D_EVIDENCE_DIR ?? "C:/Users/nooro/AppData/Local/Temp/monocode-cc/cc7d/evidence";
mkdirSync(evidence, { recursive: true });
const sourceFiles = ["../../model/attention.ts", "../../ui/AttentionQueue.tsx", "../../ui/attentionQueue.css", "../../../sessions/ui/QuestionForm.tsx", "../../../sessions/ui/UsageLimitNotice.tsx", "../../../monos/ui/MonoCodexStorageNotice.tsx"];
const sourceHashes = () => Object.fromEntries(sourceFiles.map(path => [path, createHash("sha256").update(readFileSync(new URL(path, import.meta.url))).digest("hex")]));
const sourcesBefore = sourceHashes();
const launchDirectory = mkdtempSync(join(tmpdir(), "monocode-cc7d-browser-"));
const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toUpperCase() !== "CODEX_HOME" && !key.toUpperCase().startsWith("ORCA_")));
environment.NODE_OPTIONS = "--no-experimental-webstorage";
environment.CC7D_LAUNCH_DIR = launchDirectory;
environment.CC7D_EVIDENCE_DIR = evidence;
const args = [fileURLToPath(new URL("../../../../../node_modules/@playwright/test/cli.js", import.meta.url)), "test", "--config", fileURLToPath(new URL("./playwright.config.ts", import.meta.url)), ...process.argv.slice(2)];
const log = createWriteStream(join(evidence, "browser-run.log"));
const startedAt = new Date().toISOString();
const child = spawn(process.execPath, args, { cwd: launchDirectory, env: environment, windowsHide: true });
child.stdout.on("data", chunk => { log.write(chunk); process.stdout.write(chunk); });
child.stderr.on("data", chunk => { log.write(chunk); process.stderr.write(chunk); });
child.on("error", error => { log.write(String(error)); process.exitCode = 1; });
child.on("close", exitCode => {
  log.end();
  const sourcesAfter = sourceHashes();
  writeFileSync(join(evidence, "browser-launch.json"), JSON.stringify({ startedAt, finishedAt: new Date().toISOString(), processId: child.pid, exitCode,
    launchDirectory, fixtureIdentifier: "monocode.cc7d.synthetic-attention", removedOrcaVariables: Object.keys(process.env).filter(key => key.toUpperCase().startsWith("ORCA_")),
    codexHomeUnset: !("CODEX_HOME" in environment), orcaVariablesUnset: !Object.keys(environment).some(key => key.toUpperCase().startsWith("ORCA_")),
    liveModelTurns: 0, realProfileWrites: 0, browserContexts: "temporary Playwright contexts; no persistent profile",
    sourcesBefore, sourcesAfter, sourcesUnchanged: JSON.stringify(sourcesBefore) === JSON.stringify(sourcesAfter) }, null, 2));
  process.exitCode = exitCode ?? 1;
});
