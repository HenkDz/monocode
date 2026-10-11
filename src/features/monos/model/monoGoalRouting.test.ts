import { describe, expect, it, vi } from "vitest";
import { newSession } from "../../sessions/model/session";
import { enqueueMonoMessage } from "./monoMessaging";
import { deliverFloatingMonoRequest, type FloatingMonoHost } from "./floatingMono";
import { MonoManagerGoals, type GoalLedger, type ManagerGoalHost } from "./monoManagerGoals";
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

describe("exact project routes", () => {
  it.each(["Fix Atlas login", "Fix c:\\CODE\\ATLAS login", "Fix C:/code/atlas/ login"])("matches %s", text => {
    expect(decide(text)).toMatchObject({ kind: "manager", project: { id: "c:/code/atlas", managerMonoId: "atlas-manager" } });
  });
  it("respects boundaries and overlapping names", () => {
    const ctx: MonoGoalRoutingContext = { ownerId: "grand", projects: [
      { ...context().projects[0], name: "Atlas" },
      { ...context().projects[1], name: "Atlas API" },
    ] };
    expect(decide("Fix Atlas API login", { context: ctx })).toMatchObject({ kind: "manager", project: { name: "Atlas API" } });
    expect(decide("Fix Atlases login")).toMatchObject({ kind: "grand" });
    expect(decide("Fix Atlas-old login")).toMatchObject({ kind: "grand" });
    ctx.projects[1].name = "Atlas";
    expect(decide("Fix Atlas login", { context: ctx })).toMatchObject({ kind: "grand" });
  });
  it("uses the exact nested repository, never its parent or an unregistered descendant", () => {
    const ctx = context();
    ctx.projects.push({ ...ctx.projects[1], id: "c:/code/atlas/nested", path: "C:/code/Atlas/nested", name: "Nested" });
    expect(decide("Fix C:/code/Atlas/nested", { context: ctx })).toMatchObject({ kind: "manager", project: { name: "Nested" } });
    expect(decide("Fix C:/code/Atlas/unknown", { context: ctx })).toMatchObject({ kind: "grand" });
    expect(decide("Fix C:/code/Atlas and C:/code/Atlas/nested", { context: ctx })).toMatchObject({ kind: "grand" });
  });
  it.each(["Fix Atlas and Beacon", "Compare Atlas costs", "Atlas versus alternatives", "Update across projects", "Atlas compared to alternatives", "Update both repos"])("falls back for %s", text => {
    expect(decide(text)).toMatchObject({ kind: "grand" });
  });
  it.each([
    "Update Atlas and C:/code/Beacon",
    "Update Atlas and C:/code/Beacon/src/index.ts in the same change",
    "Update Atlas and c:\\CODE\\BEACON\\src\\index.ts in the same change",
  ])("counts a second project referenced by path: %s", text => {
    expect(decide(text)).toMatchObject({ kind: "grand", reason: "More than one project mentioned" });
  });
  it("counts an unavailable second project referenced by a descendant path", () => {
    expect(decide("Update Atlas and C:/code/Beacon/src/index.ts", {
      context: monoGoalRoutingContext(owner, roster, projects, ["C:/code/Beacon"]),
    })).toMatchObject({ kind: "grand", reason: "More than one project mentioned" });
  });
  it("counts Unix descendant paths while preserving case and project boundaries", () => {
    const ctx = { ...context(), projects: context().projects.map(project => ({ ...project, path: `/code/${project.name}` })) };
    expect(decide("Update Atlas and /code/Beacon/src/index.ts", { context: ctx }))
      .toMatchObject({ kind: "grand", reason: "More than one project mentioned" });
    expect(decide("Update Atlas and /code/beacon/src/index.ts", { context: ctx }))
      .toMatchObject({ kind: "manager", project: { name: "Atlas" } });
    expect(decide("Update Atlas and C:/code/Beacon-old/src/index.ts"))
      .toMatchObject({ kind: "manager", project: { name: "Atlas" } });
  });
  it("uses descendant references for ambiguity without authorizing an automatic route", () => {
    for (const path of ["src/index.ts", "@index.ts", ".env"])
      expect(decide(`Update C:/code/Atlas/${path}`))
        .toMatchObject({ kind: "grand", reason: "Choose a project or mention its exact name or path" });
    expect(decide("Update Atlas and C:/code/Atlas/src/index.ts"))
      .toMatchObject({ kind: "manager", project: { name: "Atlas" }, reason: "Exact project name" });
    expect(decide("Update C:/code/Atlas/src/index.ts", {
      choice: { mode: "goal", override: "manager", projectId: "c:/code/atlas" },
    })).toMatchObject({ kind: "manager", project: { name: "Atlas" } });
    expect(decide("Update C:/code/Beacon/src/index.ts", {
      choice: { mode: "goal", override: "manager", projectId: "c:/code/atlas" },
    })).toMatchObject({ kind: "grand", reason: "Selected project differs from the text" });
  });
  it("keeps descendant references attached to the most specific registered root", () => {
    const ctx = context();
    ctx.projects.push({ ...ctx.projects[1], id: "c:/code/atlas/nested", path: "C:/code/Atlas/nested", name: "Nested" });
    expect(decide("Update Nested and C:/code/Atlas/nested/src/index.ts", { context: ctx }))
      .toMatchObject({ kind: "manager", project: { name: "Nested" }, reason: "Exact project name" });
    expect(decide("Update Atlas and C:/code/Atlas/nested/src/index.ts", { context: ctx }))
      .toMatchObject({ kind: "grand", reason: "More than one project mentioned" });
    expect(decide("Update C:/code/Atlas/nested/src/index.ts", { context: ctx }))
      .toMatchObject({ kind: "grand", reason: "Choose a project or mention its exact name or path" });
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
  it("keeps Unix path case significant", () => {
    const ctx: MonoGoalRoutingContext = { ownerId: "grand", projects: [{ id: "/code/Atlas", path: "/code/Atlas", name: "Unique project", managerMonoId: "manager", available: true }] };
    expect(decide("Fix /code/Atlas", { context: ctx })).toMatchObject({ kind: "manager" });
    expect(decide("Fix /code/atlas", { context: ctx })).toMatchObject({ kind: "grand" });
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
    } }, runtime, async () => true)).rejects.toThrow("could not be sent");
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
    await submitMonoGoal(f.input, f.host);
    expect(f.host.grand).toHaveBeenCalledOnce();
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
