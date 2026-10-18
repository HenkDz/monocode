import { describe, expect, it } from "vitest";
import { appCliApprovalReason, isDirectAppCliCommand, powerShellAppTokens } from "./appCliApproval";
import { readFileSync } from "node:fs";

const exe = "C:/Users/nooro/Mono Code/monocode-org-preview.exe";
const native = readFileSync("src-tauri/src/control_cli.rs", "utf8");
const actions = [...native.match(/const APP_ACTIONS[^=]*= \[([\s\S]*?)\];/)![1].matchAll(/"([^"]+)"/g)].map(match => match[1]);
const policy = { tempDir: "C:/Users/nooro/AppData/Local/Temp", actions, trustedRtk: "C:/Trusted/rtk.exe" };
describe("exact app CLI approval", () => {
  it("uses the current renamed preview identity instead of another copy or a previous process", () => {
    const previews = ["C:/previews/monocode-r5-old.exe", "C:/previews/monocode-r5-renamed.exe"];
    const pwsh = "C:/Program Files/PowerShell/7/pwsh.exe";
    const shellPolicy = { ...policy, trustedPowerShell: [pwsh] };
    for (const running of previews) {
      for (const invoked of previews) {
        expect(isDirectAppCliCommand([invoked, "app", "projects.list"], running, shellPolicy)).toBe(invoked === running);
        expect(isDirectAppCliCommand([pwsh, "-NoProfile", "-Command", `${invoked} app projects.list`], running, shellPolicy)).toBe(invoked === running);
      }
      expect(isDirectAppCliCommand([running.toUpperCase().replace(/\//g, "\\"), "app", "projects.list"], running, shellPolicy)).toBe(true);
      expect(isDirectAppCliCommand(["monocode.exe", "app", "projects.list"], running, shellPolicy)).toBe(false);
    }
  });
  it("approves team actions only through the existing exact executable and private-input rules", () => {
    for (const action of ["team.list", "team.hire", "team.update", "team.memory.add", "team.memory.forget", "team.retire"]) {
      expect(actions).toContain(action);
      const args = [exe, "app", action, "--input", policy.tempDir + "/input.json", "--request-id", "retry-1"];
      expect(isDirectAppCliCommand(args, exe, policy)).toBe(true);
      expect(isDirectAppCliCommand(["other.exe", ...args.slice(1)], exe, policy)).toBe(false);
      expect(isDirectAppCliCommand([...args.slice(0, 4), "C:/outside.json", ...args.slice(5)], exe, policy)).toBe(false);
      expect(isDirectAppCliCommand([...args, "--role", "manager"], exe, policy)).toBe(false);
    }
    expect(isDirectAppCliCommand([exe, "app", "team.unknown"], exe, policy)).toBe(false);
  });
  it("accepts one trusted PowerShell transport, optionally preceded by trusted RTK", () => {
    const ps = "C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe";
    const shellPolicy = { ...policy, trustedPowerShell: [ps, "C:/Program Files/PowerShell/7/pwsh.exe", "powershell"] };
    for (const launcher of shellPolicy.trustedPowerShell) {
      const script = `& '${exe}' app projects.list --input '${policy.tempDir}/input.json'`;
      for (const prefix of [[], [policy.trustedRtk], [policy.trustedRtk, "proxy"]]) {
        expect(isDirectAppCliCommand([...prefix, launcher, "-NoProfile", "-Command", script], exe, shellPolicy)).toBe(true);
        expect(isDirectAppCliCommand([...prefix, launcher, "-NoProfile", "-NonInteractive", "-Command", script], exe, shellPolicy)).toBe(true);
      }
      expect(isDirectAppCliCommand(`"${launcher}" -NoProfile -Command "${script}"`, exe, shellPolicy)).toBe(true);
    }
    // Activity's preview-style executable and JSON spelling, inside the now-required quoted invocation.
    const preview = "C:\\Users\\nooro\\orca\\workspaces\\monocode\\nou\\target\\manager-final-preview\\debug\\monocode.exe";
    expect(isDirectAppCliCommand([ps, "-NoProfile", "-Command", `& '${preview}' app projects.list --input '${policy.tempDir}/input.json'`], preview, shellPolicy)).toBe(true);
  });
  it("rejects shadow launchers, extra shell syntax, flags and nesting", () => {
    const ps = "C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe";
    const shellPolicy = { ...policy, trustedPowerShell: [ps] };
    const script = `& '${exe}' app projects.list --input '${policy.tempDir}/input.json'`;
    const invalid = [
      ["powershell", "-NoProfile", "-Command", script], // native policy did not authorize bare lookup
      ["C:/repo/powershell.exe", "-NoProfile", "-Command", script],
      [policy.tempDir + "/pwsh.exe", "-NoProfile", "-Command", script],
      [ps, "-Command", script], [ps, "-NoProfile", "-EncodedCommand", "aGVsbG8="],
      [ps, "-NoProfile", "-File", "C:/script.ps1"],
      [ps, "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script],
      [ps, "-NoProfile", "-Command", script, "extra"],
      [ps, "-NoProfile", "-NoProfile", "-Command", script],
      [ps, "-NoProfile", "-Command", `${exe} app projects.list`], // original Activity string without required quotes
      [ps, "-NoProfile", "-Command", `'${exe}' app projects.list`], // real PS parser rejects this without &
      [ps, "-NoProfile", "-Command", `${script}; whoami`],
      [ps, "-NoProfile", "-Command", `${script} | whoami`],
      [ps, "-NoProfile", "-Command", `${script} & whoami`],
      [ps, "-NoProfile", "-Command", `& ${script}`],
      [ps, "-NoProfile", "-Command", `${script}\nwhoami`],
      [ps, "-NoProfile", "-Command", `${script} > out`],
      [ps, "-NoProfile", "-Command", `'${exe}' app unknown.action`],
      [ps, "-NoProfile", "-Command", `'${exe}' app projects.list --json 'invalid'`],
      [ps, "-NoProfile", "-Command", `'${exe}' app memory.read --input 'C:/outside.json'`],
      [ps, "-NoProfile", "-Command", `'${ps}' -NoProfile -Command ${script}`],
      [ps, "-NoProfile", "-Command", `'${policy.trustedRtk}' proxy ${script}`],
      ["rtk", "proxy", ps, "-NoProfile", "-Command", script],
      [policy.trustedRtk, "proxy", policy.trustedRtk, "proxy", ps, "-NoProfile", "-Command", script],
    ];
    for (const args of invalid) expect(isDirectAppCliCommand(args, exe, shellPolicy), JSON.stringify(args)).toBe(false);
    expect(isDirectAppCliCommand(`"${ps}""" -NoProfile -Command "${script}"`, exe, shellPolicy)).toBe(false);
    expect(isDirectAppCliCommand(`"${ps}" -NoProfile -Command "${script}"tail`, exe, shellPolicy)).toBe(false);
  });
  it("uses PowerShell's bounded ASCII quoting grammar, never POSIX quote concatenation", () => {
    const valid = `& '${exe}' app projects.list --input '${policy.tempDir}/with spaces/input.json' --request-id retry-1`;
    expect(powerShellAppTokens(valid)).toEqual([exe, "app", "projects.list", "--input", policy.tempDir + "/with spaces/input.json", "--request-id", "retry-1"]);
    for (const code of [0xab, 0xbb, 0x2013, 0x2014, 0x2015, ...Array.from({ length: 8 }, (_, i) => 0x2018 + i)]) {
      expect(powerShellAppTokens(valid.replace("with spaces", `with${String.fromCharCode(code)}spaces`))).toBeUndefined();
    }
    for (const bad of [
      valid.replace("'", "\u2018"), valid.replace("'", "\u2019"), valid.replace("'", "\u201c"),
      valid.replace("--input", "\u2013input"), valid.replace("--input", "\u2014input"),
      valid.replace("--input", "--% --input"), valid.replace("with spaces", "with''spaces"),
      valid.replace("with spaces", 'with"spaces'), valid.replace("with spaces", "with`spaces"),
      valid.replace("with spaces", "$env:PAYLOAD"), valid.replace("with spaces", "\u00abspaces\u00bb"),
      `& '${exe}' app projects.list --json '{}'`, `& '${exe}' app projects.list --json '{"a":1}'`,
      `& '${exe}' app projects.list --input 'C:/Temp/a'"b"`,
      `& '${exe}' app projects.list --input C:\\Temp\\input.json`,
    ]) expect(powerShellAppTokens(bad), bad).toBeUndefined();
  });
  it("handles the exact Codex transport rendering without rewriting its argv", () => {
    const nativeExe = String.raw`C:\Users\nooro\orca\workspaces\monocode\nou\target\manager-final-preview\debug\monocode.exe`;
    const pwsh = String.raw`C:\Program Files\PowerShell\7\pwsh.exe`;
    const script = String.raw`& 'C:\\Users\\nooro\\orca\\workspaces\\monocode\\nou\\target\\manager-final-preview\\debug\\monocode.exe' app projects.list`;
    const command = String.raw`"C:\\Program Files\\PowerShell\\7\\pwsh.exe" -NoProfile -Command "${script}"`;
    expect(isDirectAppCliCommand(command, nativeExe, { ...policy, trustedPowerShell: [pwsh] })).toBe(true);
    expect(powerShellAppTokens(script)?.[0]).toBe(nativeExe.replace(/\\/g, "\\\\"));
  });
  it("accepts Codex's bare absolute Windows executable through trusted PowerShell", () => {
    const nativeExe = "C:/Users/nooro/orca/workspaces/monocode/team-building/target/r5-acceptance/monocode-r5-cards.exe";
    const pwsh = "C:/Program Files/PowerShell/7/pwsh.exe";
    const script = `${nativeExe} app projects.list`;
    const shellPolicy = { ...policy, trustedPowerShell: [pwsh] };
    expect(powerShellAppTokens(script)).toEqual([nativeExe, "app", "projects.list"]);
    expect(isDirectAppCliCommand([pwsh, "-NoProfile", "-Command", script], nativeExe, shellPolicy)).toBe(true);
    expect(isDirectAppCliCommand(`"${pwsh}" -NoProfile -Command '${script}'`, nativeExe, shellPolicy)).toBe(true);
    for (const bad of [`'${nativeExe}' app projects.list`, "monocode.exe app projects.list", "./monocode.exe app projects.list", `${script}; whoami`, `${script} | whoami`, `${script} $env:FOO`]) {
      expect(powerShellAppTokens(bad)).toBeUndefined();
    }
  });
  it("reports untrusted RTK wrapping PowerShell without approving either transport", () => {
    const ps = "C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe";
    const shellPolicy = { ...policy, trustedPowerShell: [ps] };
    const script = `& '${exe}' app projects.list`;
    const argv = ["rtk", "proxy", ps, "-NoProfile", "-Command", script];
    for (const command of [argv, `rtk proxy "${ps}" -NoProfile -Command "${script}"`]) {
      expect(isDirectAppCliCommand(command, exe, shellPolicy)).toBe(false);
      expect(appCliApprovalReason(command, policy.trustedRtk)).toBe("wrapped by untrusted rtk, call the app CLI directly");
    }
  });
  it("accepts exactly one transparent RTK wrapper for string and argv calls", () => {
    const preview = "C:\\Users\\nooro\\orca\\workspaces\\monocode\\nou\\target\\manager-final-preview\\debug\\monocode.exe";
    expect(isDirectAppCliCommand(`rtk proxy '${preview}' app projects.list`, preview, policy)).toBe(false);
    expect(appCliApprovalReason(`rtk proxy '${preview}' app projects.list`, policy.trustedRtk)).toBe("wrapped by untrusted rtk, call the app CLI directly");
    for (const wrapper of [[policy.trustedRtk], [policy.trustedRtk, "proxy"]]) {
      const valid = [...wrapper, exe, "app", "goals.assign", "--json", '{"goal":"Test"}'];
      expect(isDirectAppCliCommand(valid, exe, policy)).toBe(true);
      expect(isDirectAppCliCommand(valid.map(token => `'${token}'`).join(" "), exe, policy)).toBe(true);
    }
    for (const args of [
      ["rtk", exe, "app", "projects.list"], ["C:/repo/rtk.exe", exe, "app", "projects.list"],
      [policy.tempDir + "/rtk.exe", "proxy", exe, "app", "projects.list"],
      ["C:/Tools/rtk.exe", "proxy", exe, "app", "projects.list"],
      ["rtk", "proxy", exe, "notapp"], ["rtk", "other.exe", "app", "projects.list"],
      ["rtk", "rtk", exe, "app", "projects.list"], ["rtk", "--flag", exe, "app", "projects.list"],
      ["rtk", "proxy", exe, "app", "x; rm"], ["rtk", exe, "app", "memory.read", "--input", "C:/private.json"],
      ["powershell", "-NoProfile", "-Command", `'${exe}' app projects.list`],
      ["pwsh", "-Command", `'${exe}' app projects.list`], ["cmd", "/c", `'${exe}' app projects.list`],
      ["bash", "-lc", `'${exe}' app projects.list`], ["rtk", "proxy", "powershell", "-Command", `'${exe}' app projects.list`],
    ]) expect(isDirectAppCliCommand(args, exe, policy), args.join(" ")).toBe(false);
  });
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
