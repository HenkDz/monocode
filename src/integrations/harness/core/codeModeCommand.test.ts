import { describe, expect, it } from "vitest";
import { codeModeCommand, commandSummary } from "./codeModeCommand";

describe("code-mode command labels", () => {
  it("reads nested actual exec_command calls and both command keys", () => {
    expect(codeModeCommand('text(await tools.exec_command({cmd: "cargo check --lib", yield_time_ms: 1000}));')).toBe("cargo check --lib");
    expect(codeModeCommand("const result = await tools.exec_command({command: 'npm test -- --run'}); text(result);")).toBe("npm test -- --run");
    expect(codeModeCommand('await Promise.all([tools.exec_command({cmd: "git status"}), tools.exec_command({cmd: "git diff"})]);')).toBe("git status");
  });

  it("ignores comments and strings that only mention a call", () => {
    expect(codeModeCommand('// tools.exec_command({cmd: "fake"})\ntext("tools.exec_command({cmd: \'also fake\'})");')).toBeUndefined();
    expect(codeModeCommand('/* tools.exec_command({cmd: "fake"}) */ await tools.exec_command({cmd: "real"});')).toBe("real");
  });

  it("decodes literals without evaluating expressions or template interpolation", () => {
    expect(codeModeCommand("await tools.exec_command({cmd: `# preparation\ncargo check\ncargo test`});")).toBe("# preparation\ncargo check\ncargo test");
    expect(codeModeCommand('await tools.exec_command({cmd: "echo \\"quoted\\"\\nnext"});')).toBe('echo "quoted"\nnext');
    expect(codeModeCommand(String.raw`await tools.exec_command({cmd: "echo \x41\u0042\u{43}"});`)).toBe("echo ABC");
    expect(codeModeCommand('await tools.exec_command({cmd: `cargo ${globalThis.cctxExecuted = true}`});')).toBeUndefined();
    expect(codeModeCommand('await tools.exec_command({cmd: (() => { globalThis.cctxExecuted = true; return "fake"; })()});')).toBeUndefined();
    expect((globalThis as Record<string, unknown>).cctxExecuted).toBeUndefined();
  });

  it("falls back on malformed input, dynamic properties and overriding spreads", () => {
    for (const code of [
      'await tools.exec_command({cmd: "unfinished',
      'await tools.exec_command({cmd: command});',
      'await tools.exec_command({cmd: "fake", ...options});',
      'await tools.exec_command({cmd: "first", cmd: "last"});',
      'await tools.exec_command({[key]: "command"});',
      'await tools.exec_command({cmd: "fake", [key]: "override"});',
      String.raw`await tools.exec_command({cmd: "fake", "c\u006dd": "actual"});`,
      String.raw`await tools.exec_command({cmd: "fake", "\x63md": "actual"});`,
      'await tools.exec_command({cmd: "fake", get cmd() { return "actual"; }});',
      'await tools.exec_command({cmd: "fake", set cmd(value) {}});',
      'await tools.exec_command(options, {cmd: "second argument"});',
      'await other.exec_command({cmd: "different tool"});',
    ]) expect(codeModeCommand(code)).toBeUndefined();
  });

  it("normalizes physical template CR/CRLF before escapes without changing escaped carriage returns", () => {
    expect(codeModeCommand('await tools.exec_command({cmd: `echo first\r\necho second\recho third`});')).toBe("echo first\necho second\necho third");
    expect(codeModeCommand('await tools.exec_command({cmd: `echo first\\r\\necho second`});')).toBe("echo first\r\necho second");
    expect(codeModeCommand(String.raw`await tools.exec_command({cmd: "echo first\r\necho second"});`)).toBe("echo first\r\necho second");
    expect(codeModeCommand('await tools.exec_command({cmd: `echo first\\\r\necho second`});')).toBe("echo firstecho second");
  });

  it("shows the first meaningful line and keeps long commands specific", () => {
    expect(commandSummary("\n# setup\n// context\ncargo check --lib\ncargo test")).toBe("cargo check --lib");
    const command = `cargo check ${"--features abc ".repeat(50)}`;
    expect(commandSummary(command)).toHaveLength(160);
    expect(commandSummary(command)).toMatch(/^cargo check .*…$/);
    expect(commandSummary(" ")).toBe("");
  });
});
