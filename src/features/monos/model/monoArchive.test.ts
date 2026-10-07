// @vitest-environment happy-dom
import { webcrypto } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  archiveMonoConversation,
  archiveProjectMonos,
  offerProjectMonoRestore,
  projectMonoTeam,
} from "./monoArchive";
import {
  createMono,
  listMonos,
  monoForSession,
  reorderMonos,
  updateMono,
  monoRuntimeMode,
  type Mono,
} from "./mono";
import { monoEngineId } from "./monoEngines";
import type { OrchestrationRun } from "../../orchestration/model/orchestration";
import { newSession, type Session } from "../../sessions/model/session";
import { canDispatchQueuedHead } from "../../sessions/model/messageQueue";
import { ensureMonoSession } from "./monoWorkspace";

const project = "C:/Code/App";
const roster: (Mono & { runtimeMode?: Session["runtimeMode"] })[] = [
  {
    id: "manager",
    role: "manager",
    name: "App Manager",
    projects: [project],
    managerProject: project,
    managerEngineId: "manager-engine",
    workerProjects: ["C:/Code/App-old"],
    sessionId: "manager-chat",
    mascot: "crab",
    color: "red",
    teamInitialized: true,
    runtimeMode: "supervised",
  },
  {
    id: "backend",
    origin: "starter",
    role: "member",
    reportsTo: "manager",
    specialty: "Backend",
    name: "Backend",
    projects: [project],
    sessionId: "backend-chat",
    runtimeMode: "full-access",
    mascot: "cat",
    color: "red",
  },
  {
    id: "reviewer",
    origin: "starter",
    role: "member",
    reportsTo: "manager",
    specialty: "Reviewer",
    projects: [project],
    mascot: "ghost",
    color: "red",
  },
  {
    id: "other",
    role: "manager",
    projects: ["C:/Code/Other"],
    sessionId: "other-chat",
    mascot: "cat",
    color: "blue",
  },
];
const identities = roster.map(({ runtimeMode: _legacyMode, ...mono }) => mono);
const engine = () => ({
  snapshot: vi.fn(
    () =>
      [
        { leadId: "saved-owned-engine", ownerMonoId: "backend" },
        { leadId: "saved-session-engine", ownerSessionId: "manager-chat" },
        { leadId: "other-engine", ownerMonoId: "other" },
      ] as OrchestrationRun[],
  ),
  stopRun: vi.fn(
    async (_id: string, _options?: { retainWorktrees?: boolean }) => {},
  ),
  start: vi.fn(),
});

beforeEach(() => {
  const stored = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => stored.set(key, value),
    removeItem: (key: string) => stored.delete(key),
  });
  vi.stubGlobal("crypto", webcrypto);
  localStorage.setItem("monocode:mono-roster", JSON.stringify(roster));
  listMonos(true);
  localStorage.setItem("test:transcripts", "retained history");
});
afterEach(() => vi.unstubAllGlobals());

it("archives only the matching Manager and members, retaining stored identities and history", async () => {
  const runs = engine();
  const stopConversation = vi.fn(async (_id: string) => {});
  const archived = await archiveProjectMonos(
    "c:\\code\\APP\\",
    runs,
    stopConversation,
  );
  expect(archived.map((mono) => mono.id)).toEqual([
    "manager",
    "backend",
    "reviewer",
  ]);
  expect(listMonos().map((mono) => mono.id)).toEqual(["other"]);
  expect(projectMonoTeam(project).map((mono) => mono.id)).toEqual([
    "manager",
    "backend",
    "reviewer",
  ]);
  expect(monoForSession("manager-chat")?.archivedAt).toEqual(
    expect.any(Number),
  );
  for (const original of roster) {
    const stored = listMonos(true).find((mono) => mono.id === original.id)!;
    const { runtimeMode: _legacyMode, ...identity } = original;
    expect(stored).toMatchObject(identity);
    if (original.id !== "other")
      expect(stored.archivedAt).toEqual(expect.any(Number));
    else expect(stored.archivedAt).toBeUndefined();
  }
  expect(localStorage.getItem("test:transcripts")).toBe("retained history");
  expect(stopConversation.mock.calls.map(([id]) => id).sort()).toEqual([
    "backend-chat",
    "manager-chat",
  ]);
  const expectedEngines = new Set([
    "saved-owned-engine",
    "saved-session-engine",
    "manager-engine",
    await monoEngineId(roster[0], "C:/Code/App-old"),
    await monoEngineId(roster[1], project),
    await monoEngineId(roster[2], project),
  ]);
  expect(new Set(runs.stopRun.mock.calls.map(([id]) => id))).toEqual(
    expectedEngines,
  );
  expect(
    runs.stopRun.mock.calls.every(
      ([, options]) => options?.retainWorktrees === true,
    ),
  ).toBe(true);
  expect(runs.start).not.toHaveBeenCalled();
});

it("offers restore on re-add, honors cancellation and restores identity without resuming runs", async () => {
  const runs = engine();
  await archiveProjectMonos(project, runs, async () => {});
  const cancel = vi.fn(() => false);
  expect(offerProjectMonoRestore(project, cancel)).toBe(false);
  expect(cancel).toHaveBeenCalledWith(
    expect.stringContaining("Stopped runs will not resume automatically"),
  );
  expect(listMonos().map((mono) => mono.id)).toEqual(["other"]);
  const approve = vi.fn(() => true);
  expect(offerProjectMonoRestore("c:/code/app", approve)).toBe(true);
  expect(approve).toHaveBeenCalledWith(
    expect.stringContaining("2 team members"),
  );
  expect(listMonos()).toEqual(identities);
  expect(runs.start).not.toHaveBeenCalled();
  approve.mockClear();
  expect(offerProjectMonoRestore(project, approve)).toBe(false);
  expect(approve).not.toHaveBeenCalled();
});

it("preserves archived transcripts and queued goals across restore until explicit queue resume", async () => {
  const conversation: Session = {
    ...newSession("codex", project),
    id: "manager-chat",
    busy: true,
    turnReady: true,
    blocks: [
      { id: "user", role: "user", text: "Keep this goal history" },
      {
        id: "assistant",
        role: "assistant",
        text: "Existing partial result",
        streaming: true,
      },
    ],
    queuedMessages: [
      { id: "pending-goal", text: "Finish the pending goal", attachments: [] },
    ],
    queueStatus: "active",
  };
  let stored = conversation;
  await archiveProjectMonos(project, engine(), async (id) => {
    if (id === conversation.id) stored = archiveMonoConversation(conversation);
  });
  expect(stored.busy).toBe(false);
  expect(stored.turnReady).toBe(false);
  expect(stored.runtimeMode).toBe(conversation.runtimeMode);
  expect(stored.blocks.map(({ id, text }) => ({ id, text }))).toEqual(
    conversation.blocks.map(({ id, text }) => ({ id, text })),
  );
  expect(stored.blocks[1].streaming).toBe(false);
  expect(stored.queuedMessages).toEqual(conversation.queuedMessages);
  expect(stored.queueStatus).toBe("paused");
  expect(offerProjectMonoRestore(project, () => true)).toBe(true);
  const restored = JSON.parse(JSON.stringify(stored)) as Session;
  expect(canDispatchQueuedHead(restored)).toBe(false);
  expect(canDispatchQueuedHead({ ...restored, queueStatus: "active" })).toBe(
    true,
  );
});

it("retains independent Manager/member permission modes and stable engine identity through archive and chat reset", async () => {
  const runs = engine();
  const engineId = await monoEngineId(listMonos(true)[0], project);
  await archiveProjectMonos(project, runs, async () => {});
  const archivedManager = listMonos(true).find((mono) => mono.id === "manager")!;
  const archivedMember = listMonos(true).find((mono) => mono.id === "backend")!;
  expect(archivedManager.archivedAt).toEqual(expect.any(Number));
  expect(monoRuntimeMode(archivedManager, "full-access")).toBe("supervised");
  expect(monoRuntimeMode(archivedMember, "supervised")).toBe("full-access");
  expect(await monoEngineId(archivedManager, project)).toBe(engineId);
  expect(runs.stopRun).toHaveBeenCalledWith(engineId, { retainWorktrees: true });
  expect(offerProjectMonoRestore(project, () => true)).toBe(true);
  updateMono("manager", (mono) => ({ ...mono, sessionId: "reset-manager-chat" }));
  const restored = listMonos();
  expect(restored.find((mono) => mono.id === "backend")?.sessionId).toBe("backend-chat");
  expect(await monoEngineId(restored.find((mono) => mono.id === "manager")!, project)).toBe(engineId);
  expect(monoRuntimeMode(restored.find((mono) => mono.id === "manager"), "auto")).toBe("supervised");
  expect(monoRuntimeMode(restored.find((mono) => mono.id === "backend"), "auto")).toBe("full-access");
});

it("does not reopen a member chat whose project is archived while its saved conversation loads", async () => {
  let resolve!: (session: Session) => void;
  const host = {
    home: vi.fn(async () => "/home"),
    load: vi.fn(() => new Promise<Session>((ready) => { resolve = ready; })),
    create: vi.fn((cwd: string) => newSession("codex", cwd)),
    add: vi.fn(),
  };
  const opening = ensureMonoSession("backend", host);
  await archiveProjectMonos(project, engine(), async () => {});
  resolve({ ...newSession("codex", "/home"), id: "backend-chat" });
  expect(await opening).toBeUndefined();
  expect(host.create).not.toHaveBeenCalled();
  expect(host.add).not.toHaveBeenCalled();
  expect(await ensureMonoSession("backend", host)).toBeUndefined();
  expect(host.load).toHaveBeenCalledTimes(1);
});

it("keeps archived entries through visible edits, reorder and new Mono creation", async () => {
  await archiveProjectMonos(project, engine(), async () => {});
  const archived = listMonos(true).filter((mono) => mono.archivedAt != null);
  updateMono("other", (mono) => ({ ...mono, name: "Renamed other Manager" }));
  const added = createMono(["C:/Code/New"]);
  reorderMonos([added.id, "other"]);
  expect(listMonos().map((mono) => mono.id)).toEqual([added.id, "other"]);
  expect(listMonos(true).filter((mono) => mono.archivedAt != null)).toEqual(
    archived,
  );
  expect(listMonos().find((mono) => mono.id === "other")?.name).toBe(
    "Renamed other Manager",
  );
});

it("retains all roster records and transcripts if stopping a run fails", async () => {
  const runs = engine();
  runs.stopRun.mockRejectedValueOnce(new Error("Stop failed"));
  const stopConversation = vi.fn(async (_id: string) => {});
  await expect(
    archiveProjectMonos(project, runs, stopConversation),
  ).rejects.toThrow("Stop failed");
  expect(stopConversation.mock.calls.map(([id]) => id).sort()).toEqual([
    "backend-chat",
    "manager-chat",
  ]);
  expect(listMonos(true).map((mono) => mono.id)).toEqual(
    roster.map((mono) => mono.id),
  );
  expect(
    projectMonoTeam(project).every((mono) => mono.archivedAt != null),
  ).toBe(true);
  expect(localStorage.getItem("test:transcripts")).toBe("retained history");
});

it("still stops every run and conversation when a conversation stop fails", async () => {
  const runs = engine();
  const stopConversation = vi.fn(async (id: string) => {
    if (id === "manager-chat") throw new Error("Conversation stop failed");
  });
  await expect(
    archiveProjectMonos(project, runs, stopConversation),
  ).rejects.toThrow("Conversation stop failed");
  expect(stopConversation.mock.calls.map(([id]) => id).sort()).toEqual([
    "backend-chat",
    "manager-chat",
  ]);
  expect(runs.stopRun).toHaveBeenCalledWith("saved-owned-engine", {
    retainWorktrees: true,
  });
  expect(runs.stopRun).toHaveBeenCalledWith("saved-session-engine", {
    retainWorktrees: true,
  });
  expect(listMonos(true).map((mono) => mono.id)).toEqual(
    roster.map((mono) => mono.id),
  );
});

it("fails closed without stopping workers when archive storage cannot be written", async () => {
  const runs = engine();
  const stopConversation = vi.fn(async () => {});
  vi.spyOn(localStorage, "setItem").mockImplementationOnce(() => {
    throw new Error("Storage full");
  });
  await expect(
    archiveProjectMonos(project, runs, stopConversation),
  ).rejects.toThrow("Storage full");
  expect(listMonos()).toEqual(identities);
  expect(runs.stopRun).not.toHaveBeenCalled();
  expect(stopConversation).not.toHaveBeenCalled();
});

it("does not claim restoration succeeded if its storage write fails", async () => {
  await archiveProjectMonos(project, engine(), async () => {});
  vi.spyOn(localStorage, "setItem").mockImplementationOnce(() => {
    throw new Error("Storage full");
  });
  expect(() => offerProjectMonoRestore(project, () => true)).toThrow(
    "Storage full",
  );
  expect(listMonos().map((mono) => mono.id)).toEqual(["other"]);
  expect(
    projectMonoTeam(project).every((mono) => mono.archivedAt != null),
  ).toBe(true);
});

it("leaves non-managed projects and unrelated teams unchanged", async () => {
  const runs = engine();
  const stopConversation = vi.fn(async () => {});
  const confirm = vi.fn(() => true);
  expect(
    await archiveProjectMonos("C:/Code/Plain", runs, stopConversation),
  ).toEqual([]);
  expect(offerProjectMonoRestore("C:/Code/Plain", confirm)).toBe(false);
  expect(runs.stopRun).not.toHaveBeenCalled();
  expect(stopConversation).not.toHaveBeenCalled();
  expect(confirm).not.toHaveBeenCalled();
  expect(listMonos()).toEqual(identities);
});
