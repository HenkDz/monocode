import { expect, it } from "vitest";
import {
  assertDirectReport,
  resolveTeamMember,
  validateMonoOrg,
  withDefaultTeam,
  orgTurnContext,
  teamPermissionDecision,
} from "./monoOrg";
import type { Mono } from "./mono";

it("never grants native permissions from reports or unverified operation text", () => {
  for (const kind of ["event", "habit", "user"] as const) {
    const origin = { kind, messageId: "turn" };
    expect(teamPermissionDecision(origin, "deny")).toBe("deny");
    expect(() => teamPermissionDecision(origin, "allow")).toThrow(
      kind === "user" ? "scope cannot be verified" : "user-origin",
    );
  }
  expect(() => teamPermissionDecision(undefined, "allow")).toThrow(
    "user-origin",
  );
  expect(() =>
    teamPermissionDecision({ kind: "user", messageId: "turn" }, "always"),
  ).toThrow("Choose");
});

const node = (
  id: string,
  role: Mono["role"],
  projects: string[],
  reportsTo?: string,
): Mono => ({ id, role, projects, reportsTo, mascot: "cat", color: "#aaaaaa" });
const tree = () =>
  withDefaultTeam(
    [
      node("leader", "orchestrator", ["/app", "/site"]),
      node("app", "manager", ["/app"], "leader"),
      node("site", "manager", ["/site"], "leader"),
      { ...node("app-backend", "member", ["/app"], "app"), specialty: "Backend", origin: "starter" },
      { ...node("app-ui", "member", ["/app"], "app"), specialty: "UI/UX", origin: "starter" },
      { ...node("app-reviewer", "member", ["/app"], "app"), specialty: "Reviewer", origin: "starter" },
    ],
    "app",
  );

it("hands each role only its direct reports and leaves plain Mono context unchanged", () => {
  const roster = tree();
  expect(orgTurnContext(roster, "leader")).toContain('"role":"orchestrator"');
  expect(orgTurnContext(roster, "leader")).not.toContain('"id":"app-backend"');
  expect(orgTurnContext(roster, "app")).toContain('"id":"app-backend"');
  for (const id of ["leader", "app", "app-backend"]) {
    expect(orgTurnContext(roster, id)).toContain("login:false");
    expect(orgTurnContext(roster, id)).toContain("Claude's Bash tool");
    expect(orgTurnContext(roster, id)).toContain("NO leading &");
    expect(orgTurnContext(roster, id)).toContain("NEVER pass --json inline");
    expect(orgTurnContext(roster, id)).toContain("--input option remains available when needed, not required");
    expect(orgTurnContext(roster, id)).toContain("never an external MCP/node_repl process");
  }
  expect(
    orgTurnContext([...roster, node("plain", undefined, ["/app"])], "plain"),
  ).toBeUndefined();
});

it("retains existing teams and leaves new Managers empty", () => {
  const roster = tree();
  expect(
    roster
      .filter((mono) => mono.reportsTo === "app")
      .map((mono) => mono.specialty),
  ).toEqual(["Backend", "UI/UX", "Reviewer"]);
  expect(withDefaultTeam(roster, "app")).toBe(roster);
  const fresh = withDefaultTeam([node("fresh", "manager", ["/fresh"])], "fresh");
  expect(fresh).toHaveLength(1);
  expect(fresh[0].teamInitialized).toBe(true);
  expect(orgTurnContext(fresh, "fresh")).toContain("study your project's structure");
  expect(() =>
    validateMonoOrg([...roster, node("plain", undefined, ["/app"])]),
  ).not.toThrow();
});

it("rejects sideways and skipped-level messages", () => {
  const roster = tree();
  expect(resolveTeamMember(roster, "app", "Backend").id).toBe("app-backend");
  expect(assertDirectReport(roster, "leader", "app", "goal").id).toBe("app");
  for (const [boss, report] of [
    ["app-backend", "app-ui"],
    ["site", "app-backend"],
    ["leader", "app-backend"],
  ])
    expect(() => assertDirectReport(roster, boss, report, "worker")).toThrow(
      "direct report",
    );
});

it("rejects cycles, multiple leaders, duplicate Managers and cross-project members", () => {
  const roster = tree();
  expect(() =>
    validateMonoOrg(
      roster.map((mono) =>
        mono.id === "app" ? { ...mono, reportsTo: "app-backend" } : mono,
      ),
    ),
  ).toThrow("cycles");
  expect(() =>
    validateMonoOrg([...roster, node("leader2", "orchestrator", [])]),
  ).toThrow("Only one");
  expect(() =>
    validateMonoOrg([...roster, node("duplicate", "manager", ["/app"])]),
  ).toThrow("already has a Manager");
  expect(() =>
    validateMonoOrg(
      roster.map((mono) =>
        mono.id === "app-backend" ? { ...mono, projects: ["/site"] } : mono,
      ),
    ),
  ).toThrow("own project's");
});
