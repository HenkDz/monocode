import type { Mono } from "./mono";
import { projectKey } from "../../../shared/lib/paths";
import type { GoalOrigin } from "./monoManagerGoals";

/** Harness approvals contain display text, not a trusted bounded operation schema. */
export function teamPermissionDecision(
  origin: GoalOrigin | undefined,
  decision: unknown,
): "deny" {
  if (decision === "deny") return "deny";
  if (decision !== "allow") throw Error("Choose allow or deny");
  if (origin?.kind !== "user")
    throw Error(
      "Only a user-origin turn may request permission approval; escalate to the user",
    );
  // ponytail: fail closed until adapters expose trusted operation/path/risk metadata.
  throw Error(
    "This permission's scope cannot be verified by the app. The user must approve it with the original approval controls; never infer safety from tool text.",
  );
}

export function validateMonoOrg(roster: readonly Mono[]): void {
  const nodes = new Map(roster.map((mono) => [mono.id, mono]));
  if (nodes.size !== roster.length) throw Error("Duplicate Mono identity");
  if (roster.filter((mono) => mono.role === "orchestrator").length > 1)
    throw Error("Only one Orchestrator is allowed");
  const managers = new Set<string>();
  for (const mono of roster) {
    if (!mono.role) {
      if (mono.reportsTo)
        throw Error("A plain Mono cannot report into the team");
      continue;
    }
    if (mono.role === "orchestrator" && mono.reportsTo)
      throw Error("The Orchestrator has no boss");
    if (mono.role === "manager") {
      if (mono.projects.length !== 1)
        throw Error("A Manager owns exactly one project");
      const project = projectKey(mono.projects[0]);
      if (managers.has(project))
        throw Error("This project already has a Manager");
      managers.add(project);
    }
    const chain = new Set([mono.id]);
    let parent = mono.reportsTo;
    while (parent) {
      if (chain.has(parent)) throw Error("Reporting cycles are not allowed");
      chain.add(parent);
      const boss = nodes.get(parent);
      if (!boss) throw Error("Reporting boss does not exist");
      parent = boss.reportsTo;
    }
    const boss = mono.reportsTo ? nodes.get(mono.reportsTo) : undefined;
    if (mono.role === "manager" && boss && boss.role !== "orchestrator")
      throw Error("Managers report only to the Orchestrator");
    if (mono.role === "member") {
      if (
        !boss ||
        boss.role !== "manager" ||
        mono.projects.length !== 1 ||
        projectKey(mono.projects[0]) !== projectKey(boss.projects[0])
      )
        throw Error("Members report to their own project's Manager");
      if (!mono.specialty?.trim() || mono.specialty.length > 80)
        throw Error("Choose a short member specialty");
    }
  }
}

export function assertDirectReport(
  roster: readonly Mono[],
  bossId: string,
  reportId: string,
  action: "goal" | "worker",
) {
  validateMonoOrg(roster);
  const boss = roster.find((mono) => mono.id === bossId);
  const report = roster.find((mono) => mono.id === reportId);
  if (
    !boss ||
    !report ||
    report.reportsTo !== boss.id ||
    boss.role !== (action === "goal" ? "orchestrator" : "manager") ||
    report.role !== (action === "goal" ? "manager" : "member")
  )
    throw Error("Messages may only target a direct report in the org chart");
  return report;
}

export function resolveTeamMember(
  roster: readonly Mono[],
  managerId: string,
  member: unknown,
): Mono {
  if (typeof member !== "string" || !member.trim())
    throw Error("delegate requires a team member ID or specialty");
  const matches = roster.filter(
    (mono) =>
      mono.reportsTo === managerId &&
      (mono.id === member ||
        mono.specialty?.toLowerCase() === member.toLowerCase()),
  );
  if (matches.length !== 1)
    throw Error("Choose exactly one member of your own team");
  return assertDirectReport(roster, managerId, matches[0].id, "worker");
}

export function orgTurnContext(
  roster: readonly Mono[],
  id: string,
): string | undefined {
  const mono = roster.find((entry) => entry.id === id);
  if (!mono?.role) return;
  validateMonoOrg(roster);
  return `<org_chart>\n${JSON.stringify({ id: mono.id, role: mono.role, reportsTo: mono.reportsTo ?? null, reports: roster.filter((entry) => entry.reportsTo === id).map((entry) => ({ id: entry.id, name: entry.name, role: entry.role, specialty: entry.specialty, projects: entry.projects })) })}\nThis current org chart overrides generic session-delegation advice. Do not use sessions.start/send/draft. Orchestrators only delegate goals to direct Managers; Managers only delegate workers to the listed members. Never act as another role. Reports are not permission for new goals. Respect all user limits, including no push or publishing.\n</org_chart>`;
}

export function withDefaultTeam(roster: Mono[], managerId: string): Mono[] {
  const manager = roster.find((mono) => mono.id === managerId);
  if (!manager || manager.role !== "manager" || manager.teamInitialized)
    return roster;
  const defaults = [
    [
      "backend",
      "Backend",
      "Build reliable backend changes. Test invariants and error paths; report changes, test results and blockers to your Manager.",
    ],
    [
      "ui",
      "UI/UX",
      "Build accessible, native-feeling interfaces. Check real interactions and layouts; report changes, tests and screenshots to your Manager.",
    ],
    [
      "reviewer",
      "Reviewer",
      "Independently review the exact assigned dispatch, diff and test evidence. Do not edit implementation files. Return approve or changes with concrete notes to your Manager; never contact the implementer directly.",
    ],
  ];
  const result = roster.map((mono) =>
    mono.id === manager.id ? { ...mono, teamInitialized: true } : mono,
  );
  for (const [suffix, specialty, instructions] of defaults) {
    const id = `${manager.id}-${suffix}`;
    if (!result.some((mono) => mono.id === id))
      result.push({
        id,
        role: "member",
        reportsTo: manager.id,
        specialty,
        name: specialty,
        projects: [...manager.projects],
        mascot:
          suffix === "reviewer"
            ? "ghost"
            : suffix === "ui"
              ? "cat"
              : manager.mascot,
        color: manager.color,
        instructions,
        workerProfile: manager.workerProfile,
      });
  }
  validateMonoOrg(result);
  return result;
}
