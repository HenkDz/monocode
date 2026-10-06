import { describe, expect, it } from "vitest";
import { isDirectAppCliCommand } from "./appCliApproval";
import { readFileSync } from "node:fs";

const exe = "C:/Users/nooro/Mono Code/monocode-org-preview.exe";
const native = readFileSync("src-tauri/src/control_cli.rs", "utf8");
const actions = [...native.match(/const APP_ACTIONS[^=]*= \[([\s\S]*?)\];/)![1].matchAll(/"([^"]+)"/g)].map(match => match[1]);
const policy = { tempDir: "C:/Users/nooro/AppData/Local/Temp", actions };
describe("exact app CLI approval", () => {
  it.each([
    `"${exe}" app goals.assign --json '{"projectId":"nou","goal":"Test the API"}'`,
    `'${exe}' app projects.list --json '{}'`,
    `"${exe.toUpperCase()}" app projects.list`,
    [
      exe,
      "app",
      "goals.assign",
      "--json",
      '{"projectId":"nou","goal":"Test the API"}',
    ],
  ].map(command => ({ command })))("accepts a direct invocation: $command", ({ command }) => {
    expect(isDirectAppCliCommand(command, exe, policy)).toBe(true);
  });
  it.each([
    undefined,
    "",
    "monocode-org-preview.exe app projects.list",
    `"${exe}.other" app projects.list`,
    `"${exe}" app projects.list && whoami`,
    `"${exe}" app projects.list; whoami`,
    `"${exe}" app projects.list | whoami`,
    `"${exe}" app projects.list > file`,
    `"${exe}" app projects.list\nwhoami`,
    `"${exe}" app projects.list $(whoami)`,
    '"' + exe + '" app projects.list `whoami`',
    `"${exe}" app projects.list %PAYLOAD%`,
    `"${exe}" app projects.list "unterminated`,
    `powershell -Command '"${exe}" app projects.list'`,
    ["bash", "-lc", `"${exe}" app projects.list`],
    [exe, "app", "projects.list", "&&", "whoami"],
  ].map(command => ({ command })))("retains approval for ambiguous/compound commands: $command", ({ command }) => {
    expect(isDirectAppCliCommand(command, exe, policy)).toBe(false);
  });
  it("keeps Unix paths case sensitive", () => {
    expect(
      isDirectAppCliCommand("/opt/MonoCode app projects.list", "/opt/monocode", policy),
    ).toBe(false);
  });
  it("validates supported actions and flags identically for shell strings and argv", () => {
    const valid = [
      ["app", "projects.list"],
      ["app", "memory.read", "--json", "{}"],
      ["app", "goals.assign", "--json", '{"projectId":"nou","goal":"Test"}', "--request-id", "goal_1"],
      ["app", "memory.read", "--input", policy.tempDir + "/payload.json"],
      ["app", "memory.read", "--request-id", "retry-1", "--input", policy.tempDir + "/sub/payload.json"],
    ];
    const invalid = [
      [], ["control", "list"], ["app", "unknown.action"], ["app", "--help"],
      ["app", "projects.list", "--help"], ["app", "projects.list", "--extra", "x"],
      ["app", "projects.list", "--json", "invalid"], ["app", "projects.list", "--json", "null"],
      ["app", "projects.list", "--json", "{}", "--json", "{}"],
      ["app", "projects.list", "--json", "{}", "--input", policy.tempDir + "/a.json"],
      ["app", "projects.list", "--input", "C:/Users/nooro/private.json"],
      ["app", "projects.list", "--input", policy.tempDir + "-outside/a.json"],
      ["app", "projects.list", "--input", policy.tempDir + "/../private.json"],
      ["app", "projects.list", "--input", policy.tempDir + "/a.json:secret"],
      ["app", "projects.list", "--input", "-"],
      ["app", "projects.list", "--request-id", "bad/id"],
      ["app", "projects.list", "--request-id", "one", "--request-id", "two"],
      ["app", "projects.list", "--request-id"],
    ];
    for (const [cases, expected] of [[valid, true], [invalid, false]] as const) {
      for (const args of cases) {
        const argv = [exe, ...args];
        expect(isDirectAppCliCommand(argv, exe, policy), JSON.stringify(argv)).toBe(expected);
        expect(isDirectAppCliCommand(argv.map(arg => `'${arg}'`).join(" "), exe, policy), JSON.stringify(argv)).toBe(expected);
      }
    }
    expect(isDirectAppCliCommand(["/opt/monocode", "app", "memory.read", "--input", "/tmp/a.json"], "/opt/monocode", { ...policy, tempDir: "/tmp" })).toBe(true);
  });
});
