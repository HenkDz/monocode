import { describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { newSession } from "../../sessions/model/session";
import { enqueueMonoMessage } from "./monoMessaging";
import { deliverFloatingMonoRequest, type FloatingMonoHost } from "./floatingMono";
import { MonoManagerGoals, type GoalLedger, type ManagerGoalHost } from "./monoManagerGoals";
import { MONO_SUBMISSION_REJECTED } from "./monoSubmissionAcceptance";
import type { Mono } from "./mono";
import {
  appendMonoGoalCard, appendMonoGoalOrigin, appendMonoGoalPendingCard, decideMonoGoalRoute, monoGoalRoutingContext,
  submitMonoGoal, type MonoGoalProject, type MonoGoalRoutingContext, type MonoGoalSubmission,
} from "./monoGoalRouting";

const owner = { id: "grand", role: "orchestrator", projects: ["C:/code/Atlas", "C:/code/Beacon"] } as Mono;
const roster = [owner,
  { id: "atlas-manager", role: "manager", projects: ["C:/code/Atlas"], reportsTo: "grand" },
  { id: "beacon-manager", role: "manager", projects: ["C:/code/Beacon"], reportsTo: "grand" },
] as Mono[];
const projects = owner.projects.map(path => ({ path, name: path.split("/").at(-1)! }));
const context = () => monoGoalRoutingContext(owner, roster, projects);
const choice = { mode: "goal" as const, override: "auto" as const };
const decide = (text: string, other: Partial<Parameters<typeof decideMonoGoalRoute>[0]> = {}) =>
  decideMonoGoalRoute({ text, choice, context: context(), attachmentCount: 0, ...other });
const projectSetGoals = [
  "Fix Atlas and every registered project",
  "Apply this fix to Atlas and all registered projects",
  "Fix Atlas and both registered repositories",
  "Fix Atlas and each project",
  "Fix Atlas across every project",
  "Fix Atlas in all of the projects",
  "Fix Atlas and the remaining projects",
  "Fix Atlas and all our repositories",
  "Fix Atlas and every project",
  "Fix Atlas and every registered repository",
  "Fix Atlas and other registered projects",
  "Apply Atlas changes to other repositories too",
  "Fix Atlas and any other registered repo",
  "Fix Atlas and another project",
  "Fix Atlas and any registered project",
  "Fix Atlas and the rest of our repositories",
  "Additional registered projects need the Atlas fix",
  "Fix Atlas and other workspaces",
  "Fix Atlas and another codebase",
  "Fix Atlas and every other code base",
  "Fix Atlas and every other code-base",
  "Fix Atlas and every other work space",
  "Fix Atlas and every other work-space",
];

describe("exact project routes", () => {
  it.each(["Fix Atlas login", "Fix ATLAS login", "Fix (Atlas) login", "Fix `Atlas` login"])("matches %s", text => {
    expect(decide(text)).toMatchObject({ kind: "manager", project: { id: "c:/code/atlas", managerMonoId: "atlas-manager" } });
  });
  it("respects boundaries and overlapping names", () => {
    const ctx: MonoGoalRoutingContext = { ownerId: "grand", projects: [
      { ...context().projects[0], name: "Atlas" },
      { ...context().projects[1], name: "Atlas API" },
    ] };
    expect(decide("Fix Atlas API login", { context: ctx }))
      .toMatchObject({ kind: "grand", reason: "More than one project mentioned" });
    expect(decide("Fix Atlases login")).toMatchObject({ kind: "grand" });
    expect(decide("Fix Atlas-old login")).toMatchObject({ kind: "grand" });
    ctx.projects[1].name = "Atlas";
    expect(decide("Fix Atlas login", { context: ctx })).toMatchObject({ kind: "grand" });
  });
  it.each(["Fix Atlas and Beacon", "Compare Atlas costs", "Atlas versus alternatives", "Update across projects", "Atlas compared to alternatives", "Update both repos"])("falls back for %s", text => {
    expect(decide(text)).toMatchObject({ kind: "grand" });
  });
  it.each(projectSetGoals)("keeps quantified scope at Grand: %s", text => {
    for (const override of ["auto", "manager"] as const)
      expect(decide(text, { choice: { mode: "goal", override, projectId: "c:/code/atlas" } }))
        .toEqual({ kind: "grand", reason: "Comparison or cross-project goal" });
  });
  it.each(["across", "all", "both", "multiple", "between", "every", "each", "remaining",
    "other", "another", "any", "rest", "additional", "42", ""])(
    "keeps %s project sets at Grand regardless of order, qualifiers or formatting", quantifier => {
      for (const ctx of [context(), monoGoalRoutingContext(owner, roster, projects, ["C:/code/Beacon"]),
        monoGoalRoutingContext(owner, roster.filter(member => member.id !== "beacon-manager"), projects)])
        for (const override of ["auto", "manager"] as const)
          for (const noun of ["project", "projects", "repository", "repositories", "repo", "repos", "workspace", "workspaces", "codebase", "codebases",
            "work space", "work spaces", "work-space", "work-spaces", "code base", "code bases", "code-base", "code-bases"])
            for (const qualifier of ["", "registered", "one of our widely separated", "**our**\tregistered\r\n"])
              for (const text of [`Fix Atlas: _${quantifier}_ ${qualifier} ${noun}`,
                `Fix Atlas and ${noun}; ${qualifier} **${quantifier.toUpperCase()}**`])
                expect(decide(text, { context: ctx, choice: { mode: "goal", override, projectId: "c:/code/atlas" } }), text)
                  .toEqual({ kind: "grand", reason: "Comparison or cross-project goal" });
    });
  it.each(["Fix Atlas all login checks", "Fix Atlas allocations", "Fix Atlas restoring minimized windows"])(
    "keeps healthy single-project ASCII control %s", text => {
      for (const override of ["auto", "manager"] as const)
        expect(decide(text, { choice: { mode: "goal", override, projectId: "c:/code/atlas" } }))
          .toMatchObject({ kind: "manager", project: { managerMonoId: "atlas-manager" } });
    });
  it.each(["projects/repos", "projects/repositories", "workspaces/codebases", "codebase/workspace",
    "project/repo/workspace/codebase", "project-wide/repo-wide", "code-base/work-space",
    "code/base", "work/space", "code/base/work/space", "PROJECTS/REPOS,", "projects//repos",
    "projects / repos", "projects/ repos", "projects /repos", "code base/work space",
    "code**base**/work**space**", "projects\\repos", "code-base\\work-space", "code\\base",
    "projects \\ repos", "projects\\ repos", "projects \\repos"])(
    "keeps slash/backslash scope alternatives at Grand: %s", scope => {
      for (const ctx of [context(), monoGoalRoutingContext(owner, roster, projects, ["C:/code/Beacon"])])
        for (const override of ["auto", "manager"] as const)
          expect(decide(`Fix Atlas and all ${scope}`, { context: ctx,
            choice: { mode: "goal", override, projectId: "c:/code/atlas" } })).toMatchObject({ kind: "grand" });
    });
  it.each(["C:/projects/repos", "C:\\workspaces\\codebases", "/projects/repos", "\\\\projects\\repos",
    "./projects/repos", "../workspaces/codebases", ".\\codebase\\workspace", "~/projects/repos",
    "projects/repo.ts", "projects/repo.config", "projects/.repos", "projects/../repos",
    "workspace/settings", "codebase/atlas", "project/index.ts", "code/base.ts"])(
    "preserves genuine selected path metadata: %s", path => {
      expect(decide(`Fix Atlas ${path}`)).toMatchObject({ kind: "grand" });
      expect(decide(`Fix Atlas ${path}`, { choice: { mode: "goal", override: "manager", projectId: "c:/code/atlas" } }))
        .toMatchObject({ kind: "manager", reason: "Contains file paths: routed to Atlas because you selected it" });
    });
  it.each(["Fix Atlas project sidebar", "Fix Atlas repository allocations", "Fix Atlas workspace color",
    "Fix Atlas codebase startup", "Fix Atlas reports"])("deliberately over-blocks singular/prefix scope %s", text => {
    for (const override of ["auto", "manager"] as const)
      expect(decide(text, { choice: { mode: "goal", override, projectId: "c:/code/atlas" } }))
        .toEqual({ kind: "grand", reason: "Comparison or cross-project goal" });
  });
  it("keeps registered compound names and split unavailable literal conflicts safe", () => {
    for (const name of ["Atlas Project", "Atlas Workspace", "Atlas-Codebase", "Atlas Repo"])
      for (const override of ["auto", "manager"] as const) {
        const ctx = context();
        ctx.projects[0].name = name;
        ctx.projects[1] = { ...ctx.projects[1], name: "BeaconAPI", available: false };
        expect(decide(`Fix ${name} login`, { context: ctx, choice: { mode: "goal", override, projectId: ctx.projects[0].id } }))
          .toMatchObject({ kind: "grand" });
        ctx.projects[0].name = "Atlas";
        expect(decide("Fix Atlas and Beacon**API** login", { context: ctx,
          choice: { mode: "goal", override, projectId: ctx.projects[0].id } }))
          .toEqual({ kind: "grand", reason: "More than one project mentioned" });
      }
  });
  it.each(["C:/outside/repo/index.ts", "C:\\outside\\repo\\index.ts", "/outside/repo/index.ts", "\\\\server\\repo\\file.ts",
    "src/project.ts", "workspace/settings", "codebase/atlas", "project/index.ts", "code-base/index.ts", "work-space/settings",
    "C:/work-space/code-base/index.ts", "code/base.ts"])(
    "preserves scope-noun path segments only with explicit selection: %s", path => {
      const selected = { mode: "goal" as const, override: "manager" as const, projectId: "c:/code/atlas" };
      expect(decide(`Fix Atlas ${path}`)).toMatchObject({ kind: "grand" });
      expect(decide(`Fix Atlas ${path}`, { choice: selected })).toMatchObject({ kind: "manager",
        project: { managerMonoId: "atlas-manager" }, reason: "Contains file paths: routed to Atlas because you selected it" });
      expect(decide(`Fix Atlas ${path} and other projects`, { choice: selected }))
        .toEqual({ kind: "grand", reason: "Comparison or cross-project goal" });
    });
  it("keeps ASCII formatting inside ordinary scope aliases at Grand", () => {
    for (const alias of ["code\tbase", "code\r\nbase", "code**base**", "work\tspace", "work**space**", "WORK _ SPACE"])
      for (const override of ["auto", "manager"] as const)
        expect(decide(`Fix Atlas and another ${alias}`, { choice: { mode: "goal", override, projectId: "c:/code/atlas" } }))
          .toEqual({ kind: "grand", reason: "Comparison or cross-project goal" });
  });
  it.each(["Fix Atlas and Beacon.", "Fix Atlas. Update Beacon", "Fix Atlas... and Beacon"])("keeps sentence conflict %s at Grand", text => {
    for (const override of ["auto", "manager"] as const)
      for (const ctx of [context(), monoGoalRoutingContext(owner, roster, projects, ["C:/code/Beacon"]),
        monoGoalRoutingContext(owner, roster.map(member => member.id === "beacon-manager" ? { ...member, archivedAt: 1 } : member), projects)])
        expect(decide(text, { context: ctx, choice: { mode: "goal", override, projectId: "c:/code/atlas" } }))
          .toMatchObject({ kind: "grand", reason: "More than one project mentioned" });
  });
  it.each([
    { name: "Beacon API", text: "Fix Atlas and BEACON—\nAPI." },
    { name: "Beacon-API", text: "Fix Atlas and Beacon API." },
    { name: "API", text: "Fix Atlas capitalization" },
    { name: "Go", text: "Fix Atlas goals" },
  ])("conservatively blocks normalized substring $name", ({ name, text }) => {
    const ctx = context();
    ctx.projects[1].name = name;
    for (const override of ["auto", "manager"] as const)
      expect(decide(text, { context: ctx, choice: { mode: "goal", override, projectId: "c:/code/atlas" } }))
        .toMatchObject({ kind: "grand", reason: /[^\t\n\r\x20-\x7e]/.test(text)
          ? "Contains non-English or special characters, so Grand Orch will route it."
          : "More than one project mentioned" });
  });
  it("keeps duplicate and empty normalized names conservative", () => {
    const ctx = context();
    ctx.projects[0].name = "Atlas API";
    ctx.projects[1].name = "Atlas-API";
    expect(decide("Fix Atlas API login", { context: ctx }))
      .toMatchObject({ kind: "grand", reason: "More than one project mentioned" });
    ctx.projects[1].name = "...";
    expect(decide("Fix Atlas API login", { context: ctx }))
      .toMatchObject({ kind: "grand", reason: "More than one project mentioned" });
  });
  it.each(["auto", "manager"] as const)("never selects one Manager for two names in punctuation contexts (%s)", override => {
    const punctuation = ["", " ", ".", "...", "!", "?", ",", ";", ":", "-", "_", "/", "\\", "\n", "\t", '"', "`", "(", ")", "「", "」", "。", "—", "\u00a0"];
    for (const [first, second] of [["Atlas", "Beacon"], ["مونو كود", "بوابة"], ["Atlas-API", "Beacon_UI"]]) {
      const ctx = context();
      ctx.projects[0].name = first;
      ctx.projects[1].name = second;
      for (const before of punctuation)
        for (const after of punctuation) {
          const text = `Fix ${before}${first}${after} and ${after}${second}${before}`;
          const route = decide(text, { context: ctx, choice: { mode: "goal", override, projectId: ctx.projects[0].id } });
          expect(route, JSON.stringify({ text, override })).toMatchObject({ kind: "grand" });
          if (override === "manager") expect(route.reason).toBe(/[^\t\n\r\x20-\x7e]/.test(text)
            ? "Contains non-English or special characters, so Grand Orch will route it."
            : "More than one project mentioned");
        }
    }
  });
  it.each([
    "C:/code/Atlas", "c:\\CODE\\ATLAS\\", "C:/code/Beacon/src/index.ts",
    "C:/code/Beacon-old/src/index.ts", "C:/code/Atlas/nested/src/index.ts",
    "C:/scratch/beacon-junction/src/index.ts", "C:/code/Atlas/linked-beacon/src/index.ts",
    "C:/code/Atlas/../Beacon/src/index.ts", "/code/Beacon/src/index.ts", "/code/beacon/src/index.ts",
    "src/index.ts", "./src/index.ts", "../Beacon/src/index.ts", ".\\src\\index.ts", "..\\Beacon\\src\\index.ts",
    "\\\\server\\share\\Beacon\\src\\index.ts", "//server/share/Beacon/src/index.ts", "\\\\?\\C:\\code\\Beacon",
    "~/code/Beacon", "C:README", "C:Beacon", "README.md", "index.test.ts", "@index.ts", "文件.ts",
    ".env", ".gitignore", ".", "..", "/", "\\", "`src/index.ts`", '".env"',
  ])("requires explicit selection for path-like token %s", path => {
    for (const text of [`Update ${path}`, `Update Atlas and ${path}`])
      expect(decide(text)).toMatchObject({ kind: "grand", reason: /[^\t\n\r\x20-\x7e]/.test(path)
        ? "Contains non-English or special characters, so Grand Orch will route it."
        : "Contains file paths: choose a project or send to Grand Orchestrator" });
    const selected = decide(`Update ${path}`, {
      choice: { mode: "goal", override: "manager", projectId: "c:/code/atlas" },
    });
    expect(selected).toMatchObject(/[^\t\n\r\x20-\x7e]/.test(path)
      ? { kind: "grand", reason: "Contains non-English or special characters, so Grand Orch will route it." }
      : path.toLowerCase().includes("beacon")
      ? { kind: "grand", reason: path.toLowerCase().includes("atlas")
        ? "More than one project mentioned" : "Selected project differs from the text" }
      : { kind: "manager", project: { name: "Atlas" },
        reason: "Contains file paths: routed to Atlas because you selected it" });
  });
  it("keeps paths at Grand when their project is unavailable", () => {
    expect(decide("Update Atlas and C:/code/Beacon/src/index.ts", {
      context: monoGoalRoutingContext(owner, roster, projects, ["C:/code/Beacon"]),
    })).toMatchObject({ kind: "grand", reason: "Contains file paths: choose a project or send to Grand Orchestrator" });
  });
  it("routes nested projects by their unique name and keeps their paths at Grand", () => {
    const ctx = context();
    ctx.projects.push({ ...ctx.projects[1], id: "c:/code/atlas/nested", path: "C:/code/Atlas/nested", name: "Nested" });
    expect(decide("Update Nested login", { context: ctx }))
      .toMatchObject({ kind: "manager", project: { name: "Nested" }, reason: "Exact project name" });
    expect(decide("Update Nested and C:/code/Atlas/nested/src/index.ts", { context: ctx }))
      .toMatchObject({ kind: "grand" });
  });
  it("preserves textual scope and availability guards for a selected project with paths", () => {
    const selection = { mode: "goal" as const, override: "manager" as const, projectId: "c:/code/atlas" };
    expect(decide("Update Atlas and Beacon in src/index.ts", { choice: selection }))
      .toMatchObject({ kind: "grand", reason: "More than one project mentioned" });
    expect(decide("Update Beacon in src/index.ts", { choice: selection }))
      .toMatchObject({ kind: "grand", reason: "Selected project differs from the text" });
    expect(decide("Compare Atlas versions in src/index.ts", { choice: selection }))
      .toMatchObject({ kind: "grand", reason: "Comparison or cross-project goal" });
    expect(decide("Update src/index.ts", {
      choice: selection, context: monoGoalRoutingContext(owner, roster, projects, ["C:/code/Atlas"]),
    })).toMatchObject({ kind: "grand", reason: "Project has no available local Manager" });
  });
  it("lets the user select a project with no name in the goal, and override to Grand", () => {
    expect(decide("Fix login", { choice: { mode: "goal", override: "manager", projectId: "c:/code/atlas" } })).toMatchObject({ kind: "manager" });
    expect(decide("Fix Atlas", { choice: { mode: "goal", override: "grand" } })).toMatchObject({ kind: "grand" });
    expect(decide("Fix Beacon", { choice: { mode: "goal", override: "manager", projectId: "c:/code/atlas" } })).toMatchObject({ kind: "grand" });
  });
  it("keeps ordinary questions in chat and preserves attachment/8K fallback", () => {
    expect(decide("How does Atlas work?", { choice: { mode: "chat", override: "auto" } })).toMatchObject({ kind: "grand" });
    expect(decide("Fix Atlas", { attachmentCount: 1 })).toMatchObject({ kind: "grand" });
    expect(decide("Atlas " + "a".repeat(7994))).toMatchObject({ kind: "manager" });
    expect(decide("Atlas " + "a".repeat(7995))).toMatchObject({ kind: "grand" });
  });
  it("refuses archived, remote, missing and unregistered Managers", () => {
    for (const members of [roster.slice(0, 1), roster.map(m => m.id === "atlas-manager" ? { ...m, archivedAt: 1 } : m)])
      expect(decide("Fix Atlas", { context: monoGoalRoutingContext(owner, members, projects) })).toMatchObject({ kind: "grand" });
    expect(decide("Fix Atlas", { context: monoGoalRoutingContext(owner, roster, projects, ["c:\\CODE\\atlas"]) })).toMatchObject({ kind: "grand" });
    expect(decide("Fix Atlas and Beacon", { context: monoGoalRoutingContext(owner, roster, projects, ["C:/code/Beacon"]) })).toMatchObject({ kind: "grand" });
    expect(decide("Fix Atlas", { context: monoGoalRoutingContext(owner, roster, projects.slice(1)) })).toMatchObject({ kind: "grand" });
    expect(decide("Fix Atlas", { context: monoGoalRoutingContext(owner, [...roster, { ...roster[1], id: "duplicate" }], projects) })).toMatchObject({ kind: "grand" });
  });
  it("does not use paths to disambiguate duplicate names", () => {
    const ctx: MonoGoalRoutingContext = { ownerId: "grand", projects: [{ id: "/code/Atlas", path: "/code/Atlas", name: "Unique project", managerMonoId: "manager", available: true }] };
    expect(decide("Fix /code/Atlas", { context: ctx })).toMatchObject({ kind: "grand" });
    expect(decide("Fix /code/atlas", { context: ctx })).toMatchObject({ kind: "grand" });
    const duplicate = context();
    duplicate.projects[1].name = "Atlas";
    expect(decide("Fix Atlas in C:/code/Atlas", { context: duplicate })).toMatchObject({ kind: "grand" });
  });
});

function setup() {
  const saved = new Map<string, GoalLedger>();
  const storage = { load: async (id: string) => structuredClone(saved.get(id) ?? null),
    save: async (id: string, ledger: GoalLedger) => { saved.set(id, structuredClone(ledger)); } };
  let source = newSession("codex", "C:/code/Atlas");
  let manager = { ...newSession("codex", "C:/code/Atlas"), busy: true };
  let ctx = context();
  const project = { id: "c:/code/atlas", name: "Atlas", folder: "C:/code/Atlas", managerId: "atlas-engine", managerMonoId: "atlas-manager", managerExists: true,
    running: 1, needsDecision: 0, ready: 0, blocked: [], goals: [] };
  const deliver = vi.fn<ManagerGoalHost["deliver"]>(async (_goal, text, receiptId) => {
    if (!manager.queuedMessages?.some(message => message.id === receiptId))
      manager = { ...enqueueMonoMessage(manager, { id: receiptId, text, attachments: [] }), busy: true };
  });
  const goals: ManagerGoalHost = { mayDelegate: id => id === "grand", projects: async () => [project],
    deliver, status: async () => ({}), ready: async () => [] };
  const host = { context: () => ctx, ledger: new MonoManagerGoals(storage), goals,
    resolve: vi.fn(async (_project: MonoGoalProject) => project),
    persistOrigin: vi.fn(async (submission: MonoGoalSubmission, text: string) => { source = appendMonoGoalOrigin(source, submission, text); }),
    hasOrigin: (submission: MonoGoalSubmission) => source.blocks.some(block => block.monoGoalSubmission?.requestId === submission.requestId),
    persistPending: vi.fn(async (submission: MonoGoalSubmission, error: unknown) => { source = appendMonoGoalPendingCard(source, submission, error); }),
    persistCard: vi.fn(async (submission: MonoGoalSubmission, goal: Parameters<typeof appendMonoGoalCard>[2]) => { source = appendMonoGoalCard(source, submission, goal); }),
    grand: vi.fn(() => true) };
  const submission: MonoGoalSubmission = { ownerId: "grand", requestId: "request-1", userMessageId: "user-1", choice,
    projectId: "c:/code/atlas", managerMonoId: "atlas-manager", reason: "Exact project name" };
  const input = { text: "Fix Atlas login", attachmentCount: 0, origin: "user" as const, submission };
  return { saved, storage, host, input, deliver, project, source: () => source, manager: () => manager,
    setContext: (value: MonoGoalRoutingContext) => { ctx = value; } };
}

describe("shared user submission boundary", () => {
  it.each((["auto", "manager"] as const).flatMap(override =>
    [projectSetGoals[0], "Fix Atlas and all projects/repos"].map(text => ({ override, text }))))(
    "retains an older accepted project-set receipt on unchanged $override retry: $text", async ({ override, text }) => {
    const f = setup();
    f.input.text = text;
    f.input.submission.choice = { mode: "goal", override, projectId: override === "manager" ? f.project.id : undefined };
    f.input.submission.reason = override === "manager" ? "Project selected" : "Exact project name";
    await f.host.persistOrigin(f.input.submission, f.input.text);
    f.deliver.mockRejectedValueOnce(Error("offline"));
    await expect(f.host.ledger.handle("grand", { kind: "user", messageId: "user-1" }, "request-1", "goals.assign",
      { projectId: f.project.id, goal: f.input.text }, f.host.goals, {
        sourceUserMessageId: "user-1", projectId: f.project.id, managerId: f.project.managerId,
        managerMonoId: f.project.managerMonoId, override, reason: f.input.submission.reason,
      })).rejects.toThrow("offline");
    const original = structuredClone(f.saved.get("grand")!);
    f.host.ledger = new MonoManagerGoals(f.storage);
    f.setContext({ ownerId: "grand", projects: [] });
    expect(await submitMonoGoal({ ...f.input, recovery: true }, f.host)).toBe(true);
    expect(f.host.grand).not.toHaveBeenCalled();
    expect(f.host.resolve).not.toHaveBeenCalled();
    expect(f.host.ledger.goals("grand")).toHaveLength(1);
    expect(f.host.ledger.goals("grand")[0]).toMatchObject({ id: original.goals[0].id,
      requestId: "request-1", userMessageId: "user-1", projectId: f.project.id, route: original.goals[0].route });
    expect(Object.keys(f.saved.get("grand")!.receipts)).toEqual(Object.keys(original.receipts));
    expect(f.deliver.mock.calls[1][2]).toBe(f.deliver.mock.calls[0][2]);
    expect(f.source().blocks[0].monoGoalSubmission).toEqual(f.input.submission);
  });
  it.each([projectSetGoals[0], "Fix Atlas and all projects/repos"])(
    "retains an older project-set origin without creating a new assignment or Grand turn: %s", async text => {
    const f = setup();
    f.input.text = text;
    await f.host.persistOrigin(f.input.submission, f.input.text);
    expect(await submitMonoGoal({ ...f.input, recovery: true }, f.host)).toBe(true);
    expect(f.host.grand).not.toHaveBeenCalled();
    expect(f.host.resolve).not.toHaveBeenCalled();
    expect(f.deliver).not.toHaveBeenCalled();
    expect(f.host.ledger.goals("grand")).toHaveLength(0);
    expect(f.source().blocks[0].monoGoalSubmission).toEqual(f.input.submission);
    expect(f.source().blocks[1].text).toContain("original request will retry");
  });
  it("places a missing route card after its visible origin and preserves later messages", async () => {
    const f = setup();
    await submitMonoGoal(f.input, f.host);
    const goal = f.host.ledger.goals("grand")[0];
    const ordinary = { id: "ordinary-user", role: "user" as const, text: "Continue the conversation" };
    const delayed = { ...f.source(), blocks: [f.source().blocks[0], ordinary] };
    const repaired = appendMonoGoalCard(delayed, f.input.submission, goal);
    expect(repaired.blocks.map(block => block.id)).toEqual(["user-1", "route-user-1", "ordinary-user"]);
    expect(appendMonoGoalCard(repaired, f.input.submission, goal)).toBe(repaired);
    const hiddenOrigin = { ...delayed, blocks: [ordinary] };
    expect(appendMonoGoalCard(hiddenOrigin, f.input.submission, goal).blocks.map(block => block.id))
      .toEqual(["ordinary-user", "route-user-1"]);
  });
  it.each(["junction", "nested-junction", "dot-segment"] as const)("keeps a physical second-project %s reference at Grand", async variant => {
    const scratch = mkdtempSync(join(tmpdir(), "cc5cg-routing-"));
    try {
      const atlas = join(scratch, "Atlas");
      const beacon = join(scratch, "Beacon");
      mkdirSync(atlas);
      mkdirSync(join(beacon, "src"), { recursive: true });
      writeFileSync(join(beacon, "src", "index.ts"), "// synthetic fixture\n");
      const alias = variant === "nested-junction" ? join(atlas, "linked-beacon") : join(scratch, "beacon-junction");
      if (variant !== "dot-segment") symlinkSync(beacon, alias, "junction");
      const path = variant === "dot-segment" ? `${atlas}/../Beacon/src/index.ts` : `${alias}/src/index.ts`;
      expect(realpathSync(path)).toBe(realpathSync(join(beacon, "src", "index.ts")));
      const f = setup();
      const ctx = context();
      ctx.projects[0].path = atlas;
      ctx.projects[1].path = beacon;
      f.setContext(ctx);
      f.input.text = `Fix Atlas and ${path}`;
      const decision = decide(f.input.text, { context: ctx });
      expect(decision.kind).toBe("grand");
      f.input.submission = { ...f.input.submission, projectId: undefined, managerMonoId: undefined, reason: decision.reason };
      expect(await submitMonoGoal(f.input, f.host)).toBe(true);
      expect(f.host.grand).toHaveBeenCalledOnce();
      expect(f.host.resolve).not.toHaveBeenCalled();
      expect(f.host.persistOrigin).not.toHaveBeenCalled();
      expect(f.host.ledger.goals("grand")).toHaveLength(0);
      expect(f.deliver).not.toHaveBeenCalled();
    } finally {
      const root = resolve(scratch);
      if (!root.startsWith(resolve(tmpdir()) + sep) || !root.includes("cc5cg-routing-"))
        throw Error("Unexpected synthetic cleanup path");
      rmSync(root, { recursive: true, force: true });
    }
  });
  it("delivers a path-bearing goal only after explicit project selection and preserves its reason", async () => {
    const f = setup();
    f.input.text = "Fix src/index.ts";
    f.input.submission.choice = { mode: "goal", override: "manager", projectId: f.project.id };
    f.input.submission.reason = "Contains file paths: routed to Atlas because you selected it";
    expect(await submitMonoGoal(f.input, f.host)).toBe(true);
    expect(f.host.grand).not.toHaveBeenCalled();
    expect(f.deliver).toHaveBeenCalledOnce();
    expect(f.host.ledger.goals("grand")[0].route?.reason).toBe(f.input.submission.reason);
    expect(f.source().blocks[0].monoGoalSubmission).toEqual(f.input.submission);
    expect(f.source().blocks[1].text).toContain(f.input.submission.reason);
  });
  it("awaits the same goal adapter through the floating user bridge", async () => {
    const f = setup();
    const runtime: FloatingMonoHost = {
      open: async () => f.source(),
      submit: (_id, text, attachments, options) => submitMonoGoal({ text, attachmentCount: attachments.length,
        origin: "user", submission: options!.monoGoal }, f.host),
      stop: vi.fn(), approval: vi.fn(), question: vi.fn(), questionInteraction: vi.fn(),
      reveal: vi.fn(), openFile: vi.fn(), resume: vi.fn(),
    };
    await deliverFloatingMonoRequest({ id: 1, monoId: "grand", action: {
      kind: "submit", text: f.input.text, attachments: [], monoGoal: f.input.submission,
    } }, runtime, async () => true);
    expect(f.host.grand).not.toHaveBeenCalled();
    expect(f.host.ledger.goals("grand")).toHaveLength(1);
    expect(f.manager().queuedMessages).toHaveLength(1);
    runtime.submit = async () => false;
    await expect(deliverFloatingMonoRequest({ id: 2, monoId: "grand", action: {
      kind: "submit", text: f.input.text, attachments: [], monoGoal: f.input.submission,
    } }, runtime, async () => true)).rejects.toThrow(MONO_SUBMISSION_REJECTED);
  });
  it.each(Array.from({ length: 100 }, (_, index) => index))("routes scoped fixture %i with zero Grand calls", async index => {
    const f = setup();
    f.input.text += ` fixture ${index}`;
    expect(await submitMonoGoal(f.input, f.host)).toBe(true);
    expect(f.host.grand).not.toHaveBeenCalled();
    expect(f.host.ledger.goals("grand")).toHaveLength(1);
    expect(f.deliver).toHaveBeenCalledOnce();
    expect(f.manager().queuedMessages).toHaveLength(1);
    expect(f.source().harnessSessionId).toBeUndefined();
    expect(!!f.source().busy).toBe(false);
    expect(f.source().blocks[0]).toMatchObject({ id: "user-1", role: "user", monoGoalSubmission: f.input.submission });
    expect(f.source().blocks[1].monoCard).toEqual({ type: "dispatch", goalIds: [f.host.ledger.goals()[0].id] });
  });
  it("creates one receipt/card/origin on concurrent Send and reload", async () => {
    const f = setup();
    await Promise.all([submitMonoGoal(f.input, f.host), submitMonoGoal(f.input, f.host)]);
    f.host.ledger = new MonoManagerGoals(f.storage);
    await submitMonoGoal(f.input, f.host);
    expect(f.saved.get("grand")!.goals).toHaveLength(1);
    expect(Object.keys(f.saved.get("grand")!.receipts)).toEqual(["request-1"]);
    expect(f.deliver).toHaveBeenCalledOnce();
    expect(f.source().blocks).toHaveLength(2);
  });
  it("rejects conflicting concurrent request payloads instead of accepting the first goal", async () => {
    const f = setup();
    const results = await Promise.allSettled([
      submitMonoGoal(f.input, f.host),
      submitMonoGoal({ ...f.input, text: "Fix Atlas logout", submission: { ...f.input.submission, userMessageId: "user-2" } }, f.host),
    ]);
    expect(results.map(result => result.status)).toEqual(["fulfilled", "rejected"]);
    expect((results[1] as PromiseRejectedResult).reason.message).toContain("different input");
    expect(f.host.ledger.goals("grand")).toHaveLength(1);
    expect(f.deliver).toHaveBeenCalledOnce();
  });
  it("keeps a blocked outbox and card, then reload replays the same target receipt", async () => {
    const f = setup();
    f.deliver.mockRejectedValueOnce(Error("storage blocked"));
    expect(await submitMonoGoal(f.input, f.host)).toBe(true);
    expect(f.saved.get("grand")!.goals[0].state).toBe("blocked");
    f.host.ledger = new MonoManagerGoals(f.storage);
    await submitMonoGoal(f.input, f.host);
    expect(f.saved.get("grand")!.goals[0].state).toBe("queued");
    expect(f.deliver.mock.calls[0][2]).toBe(f.deliver.mock.calls[1][2]);
    expect(f.manager().queuedMessages).toHaveLength(1);
    expect(f.source().blocks).toHaveLength(2);
  });
  it("never sends an accepted goal back to Grand after its roster disappears", async () => {
    const f = setup();
    await submitMonoGoal(f.input, f.host);
    f.host.ledger = new MonoManagerGoals(f.storage);
    f.setContext({ ownerId: "grand", projects: [] });
    await submitMonoGoal(f.input, f.host);
    expect(f.host.grand).not.toHaveBeenCalled();
    expect(f.deliver).toHaveBeenCalledOnce();
  });
  it("acknowledges durable acceptance even if saving the route card fails", async () => {
    const f = setup();
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    f.host.persistCard.mockRejectedValueOnce(Error("disk full"));
    expect(await submitMonoGoal(f.input, f.host)).toBe(true);
    f.setContext({ ownerId: "grand", projects: [] });
    f.host.ledger = new MonoManagerGoals(f.storage);
    expect(await submitMonoGoal({ ...f.input, recovery: true }, f.host)).toBe(true);
    expect(f.host.ledger.goals("grand")).toHaveLength(1);
    expect(f.source().blocks).toHaveLength(2);
    expect(f.host.grand).not.toHaveBeenCalled();
    expect(f.deliver).toHaveBeenCalledOnce();
    log.mockRestore();
  });
  it("revalidates after async project resolution and origin persistence", async () => {
    const f = setup();
    f.host.resolve.mockImplementationOnce(async () => {
      f.setContext({ ownerId: "grand", projects: [] }); return f.project;
    });
    expect(await submitMonoGoal(f.input, f.host)).toBe(false);
    expect(f.host.grand).not.toHaveBeenCalled();
    expect(f.saved.size).toBe(0);
    const next = setup();
    next.host.persistOrigin.mockImplementationOnce(async () => { next.setContext({ ownerId: "grand", projects: [] }); });
    expect(await submitMonoGoal(next.input, next.host)).toBe(true);
    expect(next.host.persistPending).toHaveBeenCalledOnce();
    expect(next.deliver).not.toHaveBeenCalled();
  });
  it("preserves authority equivalent to manual goals.assign and rejects reports/habits", async () => {
    const f = setup();
    f.host.goals.mayDelegate = () => false;
    await expect(submitMonoGoal(f.input, f.host)).rejects.toThrow("Only the Orchestrator");
    for (const origin of ["event", "habit"] as const)
      await expect(submitMonoGoal({ ...f.input, origin }, f.host)).rejects.toThrow("Only a user submission");
    expect(f.saved.size).toBe(0);
  });
  it("rejects changed payloads without reviving a pending receipt", async () => {
    const f = setup();
    f.deliver.mockRejectedValueOnce(Error("offline"));
    await submitMonoGoal(f.input, f.host);
    await expect(submitMonoGoal({ ...f.input, text: "Fix Atlas logout" }, f.host)).rejects.toThrow("different input");
    await expect(submitMonoGoal({ ...f.input, submission: { ...f.input.submission, choice: { mode: "goal", override: "grand" } } }, f.host)).rejects.toThrow("different input");
    await expect(submitMonoGoal({ ...f.input, attachmentCount: 1 }, f.host)).rejects.toThrow("different input");
    expect(f.deliver).toHaveBeenCalledOnce();
  });
  it("replays a durable origin after a crash before ledger persistence without starting Grand", async () => {
    const f = setup();
    await f.host.persistOrigin(f.input.submission, f.input.text);
    f.host.ledger = new MonoManagerGoals(f.storage);
    await submitMonoGoal({ ...f.input, recovery: true }, f.host);
    expect(f.saved.get("grand")!.goals).toHaveLength(1);
    expect(f.source().blocks).toHaveLength(2);
    expect(f.host.grand).not.toHaveBeenCalled();
    const missing = setup();
    missing.setContext({ ownerId: "grand", projects: [] });
    await expect(submitMonoGoal({ ...missing.input, recovery: true }, missing.host)).rejects.toThrow("retained");
    expect(missing.host.grand).not.toHaveBeenCalled();
  });
  it("keeps a persisted origin on its original route after post-origin rejection and reload", async () => {
    const f = setup();
    const persist = f.host.persistOrigin.getMockImplementation()!;
    f.host.persistOrigin.mockImplementationOnce(async (submission, text) => {
      await persist(submission, text);
      f.setContext({ ownerId: "grand", projects: [] });
    });
    expect(await submitMonoGoal(f.input, f.host)).toBe(true);
    expect(f.source().blocks[1].text).toContain("Delivery blocked");
    expect(f.host.ledger.goals("grand")).toHaveLength(0);
    f.host.ledger = new MonoManagerGoals(f.storage);
    await submitMonoGoal(f.input, f.host);
    expect(f.host.grand).not.toHaveBeenCalled();
    f.setContext(context());
    await submitMonoGoal({ ...f.input, recovery: true }, f.host);
    expect(f.source().blocks).toHaveLength(2);
    expect(f.source().blocks[1].monoCard?.type).toBe("dispatch");
    expect(f.host.ledger.goals("grand")).toHaveLength(1);
    expect(f.deliver).toHaveBeenCalledOnce();
  });
  it("compares sanitized origin envelopes independent of object key order", async () => {
    const f = setup();
    await f.host.persistOrigin(f.input.submission, f.input.text);
    const reordered = Object.fromEntries(Object.entries(f.input.submission).reverse()) as MonoGoalSubmission;
    await expect(f.host.persistOrigin(reordered, f.input.text)).resolves.toBeUndefined();
    expect(f.source().blocks).toHaveLength(1);
  });
});
