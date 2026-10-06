import { describe, expect, it } from "vitest";
import { isDirectAppCliCommand } from "./appCliApproval";

const exe = "C:/Users/nooro/Mono Code/monocode-org-preview.exe";
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
  ])("accepts a direct invocation: %s", (command) => {
    expect(isDirectAppCliCommand(command, exe)).toBe(true);
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
  ])("retains approval for ambiguous/compound commands: %s", (command) => {
    expect(isDirectAppCliCommand(command, exe)).toBe(false);
  });
  it("keeps Unix paths case sensitive", () => {
    expect(
      isDirectAppCliCommand("/opt/MonoCode app projects.list", "/opt/monocode"),
    ).toBe(false);
  });
});
