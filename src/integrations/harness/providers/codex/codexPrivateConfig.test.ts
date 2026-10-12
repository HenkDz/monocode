import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import type { Session } from "../../../../features/sessions/model/session";
import { codexSandboxRepairSettings, codexFullAccessRepairAllowed, isCodexStorageError, MonoCodexStorageRecovery, parseCodexSandboxBlocker, parseCodexStorageConflict, parseCodexStorageRecoveryConflict } from "../../../../features/monos/model/monoCodexStorage";
import { codexStorageAccountId } from "../../../../features/monos/model/monoCodexStorageIssues";

const mock = vi.hoisted(() => ({
  handlers: new Map<string, (line: string) => void>(),
  sent: [] as { child: string; method: string; params?: Record<string, unknown> }[],
  sourceConfig: {} as Record<string, unknown>,
  store: {} as Record<string, unknown>,
  prepare: vi.fn(async (..._args: unknown[]) => ({} as Record<string, unknown>)),
  check: vi.fn(async (_settings: Record<string, unknown>) => undefined),
  spawn: vi.fn(async (..._args: unknown[]) => undefined),
}));

vi.mock("../../../../platform/tauri/platform", async importOriginal => ({
  ...await importOriginal<typeof import("../../../../platform/tauri/platform")>(), IS_WIN: true,
}));
vi.mock("../../core/child", () => ({
  checkMonoCodexSandbox: mock.check,
  acquireHarnessBridge: async () => () => {},
  prepareMonoCodexStore: mock.prepare,
  resolveCodexBinary: async () => ({ path: "/synthetic/codex" }),
  restoreMonoCodexAgentState: async () => {},
  copyMonoCodexThreads: async () => {},
  spawnChild: mock.spawn,
  killChild: async () => {},
  watchChild: (id: string, line: (line: string) => void) => mock.handlers.set(id, line),
  unwatchChild: (id: string) => mock.handlers.delete(id),
  writeChild: async (id: string, line: string) => {
    const request = JSON.parse(line);
    mock.sent.push({ child: id, ...request });
    if (request.id == null) return;
    const result = request.method === "config/read" ? { config: mock.sourceConfig }
      : request.method.startsWith("thread/") ? { thread: { id: "synthetic-thread" } }
      : request.method === "turn/start" ? { turn: { id: "synthetic-turn" } } : {};
    mock.handlers.get(id)?.(JSON.stringify({ id: request.id, result }));
    if (request.method === "turn/start") setTimeout(() => mock.handlers.get(id)?.(JSON.stringify({
      method: "turn/completed", params: { threadId: "synthetic-thread", turn: { id: "synthetic-turn", status: "completed" } },
    })), 0);
  },
}));

import { prepareCodexMonoContext } from "./codexStore";
import { __codexTestReset, sendCodexTurn, stopCodexSession } from "./codex";

const SOURCE = "# synthetic ordinary account\r\nmodel='account-model'\r\n[windows]\r\nsandbox='elevated'\r\n";
const PRIVATE = "model='private-model'\n[windows]\nsandbox='unelevated'\n";
const BLOCKER = `Codex storage needs repair: ${JSON.stringify({ sandbox: true, reason: "Manual setup alone cannot unlock elevated Mono turns", setupCommand: "synthetic setup command" })}`;
let root: string;
let source: string;
let base: string;
let contextHome: string;

beforeEach(() => {
  __codexTestReset();
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
  mock.handlers.clear(); mock.sent.length = 0; mock.spawn.mockClear(); mock.prepare.mockReset(); mock.check.mockReset();
  root = mkdtempSync(join(tmpdir(), "monocode-cc6j-private-engine-"));
  source = join(root, ".codex"); base = join(root, "codex-monos", "default");
  contextHome = join(base, ".monocode-skill-contexts", "a".repeat(64));
  mkdirSync(source, { recursive: true }); mkdirSync(contextHome, { recursive: true });
  writeFileSync(join(source, "config.toml"), SOURCE); writeFileSync(join(base, "config.toml"), PRIVATE);
  linkSync(join(base, "config.toml"), join(contextHome, "config.toml"));
  mock.store = {
    home: base, sourceHome: source, sourceKind: "account", hasThread: true,
    skillHome: contextHome, skillsContextId: "a".repeat(64),
    skillsConfig: { skills: { config: [], bundled: { enabled: false } }, plugins: {} },
    skillArgs: ["-c", "skills.bundled.enabled=false", "-c", "plugins={}"],
    privateConfig: { windows: { sandbox: "unelevated" } },
  };
  mock.prepare.mockImplementation(async () => mock.store);
  mock.sourceConfig = {
    windows: { sandbox: "elevated", retained: "account-setting" }, model: "account-model",
    sqlite_home: source, model_instructions_file: join(source, "instructions.md"),
    shell_environment_policy: { set: { KEEP: "same" } },
    plugins: { "saved@test": { enabled: false, cache_path: join(source, "plugins") } },
  };
  mock.check.mockImplementation(async settings => {
    const engine = settings.windowsSandbox ?? (settings.sandboxConfig as { windows?: { sandbox?: string } })?.windows?.sandbox;
    if (settings.sandboxRequired && engine === "elevated") throw new Error(BLOCKER);
  });
});

afterEach(async () => {
  await stopCodexSession("clicked"); await stopCodexSession("peer");
  __codexTestReset(); vi.unstubAllGlobals(); rmSync(root, { recursive: true, force: true });
});

const input = { sessionId: "witness", path: "/synthetic/codex", cwd: "/synthetic/project", providerAccountId: "account", sandboxRequired: true, sandboxNetworkAccess: false };

it.each([undefined, "unelevated"] as const)("composes the repaired private engine before readiness with explicit choice %s", async windowsSandbox => {
  // CC0GR3's witness: real codexStore/JsonRpcClient and source/private/context files; native IPC is modeled.
  const prepared = await prepareCodexMonoContext({ ...input, windowsSandbox });
  expect(prepared.config.windows).toEqual({ sandbox: "unelevated", retained: "account-setting" });
  expect(prepared.config).toMatchObject({ model: "account-model", sqlite_home: base,
    model_instructions_file: join(source, "instructions.md"), shell_environment_policy: { set: { KEEP: "same" } },
    plugins: { "saved@test": { enabled: false, cache_path: join(source, "plugins") } } });
  expect(mock.check).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ sandboxRequired: true, windowsSandbox,
    sandboxConfig: expect.objectContaining({ windows: { sandbox: "unelevated", retained: "account-setting" } }) }));
  expect(mock.sourceConfig.windows).toEqual({ sandbox: "elevated", retained: "account-setting" });
  expect(readFileSync(join(source, "config.toml"), "utf8")).toBe(SOURCE);
  expect(readFileSync(join(base, "config.toml"), "utf8")).toBe(PRIVATE);
  expect(readFileSync(join(contextHome, "config.toml"), "utf8")).toBe(PRIVATE);
  expect(mock.sent.map(request => request.method)).toEqual(["initialize", "initialized", "config/read"]);
});

it("preserves an explicit elevated choice and blocks before any outgoing thread or turn", async () => {
  await expect(prepareCodexMonoContext({ ...input, windowsSandbox: "elevated" })).rejects.toThrow("cannot unlock");
  expect(mock.check).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ windowsSandbox: "elevated",
    sandboxConfig: expect.objectContaining({ windows: { sandbox: "elevated", retained: "account-setting" } }) }));
  expect(mock.sent.some(request => ["thread/start", "thread/resume", "turn/start"].includes(request.method))).toBe(false);
  expect(readFileSync(join(source, "config.toml"), "utf8")).toBe(SOURCE);
});

it("retains account and project engine settings when no private override exists", async () => {
  delete mock.store.privateConfig;
  await expect(prepareCodexMonoContext(input)).rejects.toThrow("cannot unlock");
  expect(mock.check).toHaveBeenCalledWith(expect.objectContaining({ sandboxConfig: expect.objectContaining({ windows: { sandbox: "elevated", retained: "account-setting" } }) }));
});

const app = ts.createSourceFile("App.tsx", readFileSync(new URL("../../../../app/App.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function repairCallback(context: Record<string, unknown>) {
  let callback: ts.ArrowFunction | undefined;
  function walk(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(app) === "onCodexStorageRepair" && node.initializer && ts.isCallExpression(node.initializer) && ts.isArrowFunction(node.initializer.arguments[0])) callback = node.initializer.arguments[0];
    ts.forEachChild(node, walk);
  }
  walk(app);
  if (!callback) throw new Error("App storage repair callback missing");
  const output = ts.transpileModule(`(${callback.getText(app)})`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  return runInNewContext(output, { ...context, Error });
}

it.each(["supervised", "plan"] as const)("private repair replays the inherited %s held prompt through real App, store and provider modules", async mode => {
  const intent = mode === "plan" ? "plan" as const : undefined;
  const runtimeMode = mode === "plan" ? "full-access" as const : "supervised" as const;
  const session = (id: string, accountId: string): Session => ({ id, harness: "codex", cwd: input.cwd, model: "codex:gpt-5.4", modelSettings: {},
    title: id, blocks: [], runtimeMode, providerAccountId: accountId, providerSessionId: "synthetic-thread", codexStorageAccountId: accountId, codexStorageError: BLOCKER,
    queuedMessages: [{ id: `held-${id}`, text: `Exact held ${id} prompt`, attachments: [], intent }] });
  const sessionsRef = { current: [session("clicked", "account"), session("peer", "account"), session("other", "other-account")] };
  const recovery = new MonoCodexStorageRecovery();
  mock.store.privateConfig = { windows: { sandbox: "elevated" } };
  writeFileSync(join(base, "config.toml"), SOURCE);
  await expect(prepareCodexMonoContext({ ...input, sessionId: "clicked" })).rejects.toThrow("cannot unlock");
  mock.sent.length = 0; mock.check.mockClear();
  const otherRetry = vi.fn(); recovery.hold("other", otherRetry);
  const accepted = vi.fn();
  for (const id of ["clicked", "peer"]) recovery.hold(id, async () => {
    const current = sessionsRef.current.find(entry => entry.id === id)!;
    expect(current.codexStorageError).toBeUndefined();
    await sendCodexTurn({ sessionId: id, cwd: current.cwd, model: current.model, runtimeMode, codexStore: "mono", providerAccountId: "account",
      intent, text: current.queuedMessages![0].text, attachments: [], onAccepted: () => accepted(id), onEvent() {} });
    return true;
  });
  const stop = vi.fn(async (_harness: string, id: string) => stopCodexSession(id));
  const invoke = vi.fn(async () => {
    writeFileSync(join(base, "config.backup"), SOURCE);
    writeFileSync(join(base, "config.toml"), PRIVATE);
    mock.store.privateConfig = { windows: { sandbox: "unelevated" } };
    return { configPath: join(base, "config.toml"), backupPaths: [join(base, "config.backup")] };
  });
  const repair = repairCallback({
    sessionsRef, codexStorageRecovery: { current: recovery }, codexStorageAccountId, isCodexStorageError,
    parseCodexStorageConflict, parseCodexSandboxBlocker, codexSandboxRepairSettings, IS_WIN: true,
    selectedProviderAccountId: () => "account", remoteProjectFor: () => undefined, queuedHead: () => undefined,
    monoSkillsForSession: () => ({ skillsRole: "manager", skillsPolicy: { mode: "role" } }), sessionWorkCwd: (current: Session) => current.cwd,
    orchestrator: { forSession: () => undefined }, monoForSession: () => ({ id: "mono" }), saveMonoRuntimeMode: vi.fn(), upsertSession: vi.fn(),
    stopHarnessSession: stop, prepareCodexMonoContext, prepareMonoCodexStore: mock.prepare, resolveCodexBinary: async () => ({ path: input.path }), invoke,
    crypto: { randomUUID: () => "synthetic-receipt" }, flushSync: (action: () => void) => action(),
    setSessions: (update: (sessions: Session[]) => Session[]) => { sessionsRef.current = update(sessionsRef.current); },
    setQueueDispatchVersion: vi.fn(), setCodexStorageRepaired: vi.fn(),
  });
  await repair("clicked", "use_unelevated_sandbox");
  expect(invoke).toHaveBeenCalledExactlyOnceWith("codex_mono_use_unelevated_sandbox", { providerAccountId: "account" });
  expect(stop.mock.calls).toEqual([["codex", "clicked"], ["codex", "peer"]]);
  expect(accepted.mock.calls).toEqual([["clicked"], ["peer"]]);
  expect(mock.check.mock.calls).toHaveLength(5);
  for (const [settings] of mock.check.mock.calls) expect(settings).toMatchObject({ sandboxRequired: true, windowsSandbox: undefined,
    sandboxConfig: { windows: { sandbox: "unelevated", retained: "account-setting" } } });
  const threads = mock.sent.filter(request => request.method === "thread/start");
  expect(threads).toHaveLength(2);
  for (const thread of threads) expect(thread.params).toMatchObject({ sandbox: "read-only", approvalPolicy: mode === "plan" ? "never" : "untrusted",
    config: { windows: { sandbox: "unelevated", retained: "account-setting" }, model_instructions_file: join(source, "instructions.md") } });
  const turns = mock.sent.filter(request => request.method === "turn/start");
  expect(turns).toHaveLength(2);
  for (const [index, turn] of turns.entries()) expect(turn.params).toMatchObject({ sandboxPolicy: { type: "readOnly" },
    input: [{ type: "text", text: `Exact held ${index === 0 ? "clicked" : "peer"} prompt` }] });
  expect(recovery.hasPending("clicked")).toBe(false); expect(recovery.hasPending("peer")).toBe(false);
  expect(recovery.hasPending("other")).toBe(true); expect(otherRetry).not.toHaveBeenCalled();
  expect(sessionsRef.current.find(entry => entry.id === "other")?.codexStorageError).toBe(BLOCKER);
  expect(readFileSync(join(source, "config.toml"), "utf8")).toBe(SOURCE);
  expect(readFileSync(join(base, "config.backup"), "utf8")).toBe(SOURCE);
  expect(readFileSync(join(base, "config.toml"), "utf8")).toBe(PRIVATE);
  expect(readFileSync(join(contextHome, "config.toml"), "utf8")).toBe(PRIVATE);
});

function connectedRepair(extra: Partial<Session> = {}) {
  const clicked: Session = { id: "clicked", harness: "codex", cwd: input.cwd, model: "codex:gpt-5.4", modelSettings: {}, title: "clicked", blocks: [],
    runtimeMode: "supervised", providerAccountId: "account", providerSessionId: "synthetic-thread", codexStorageError: BLOCKER, ...extra };
  const sessionsRef = { current: [clicked] };
  const persisted = new Map([["clicked", structuredClone(clicked)]]);
  const modes = new Map([["mono-clicked", "supervised"]]);
  const recovery = new MonoCodexStorageRecovery();
  const accepted = vi.fn();
  recovery.hold("clicked", async () => {
    const session = sessionsRef.current[0];
    await sendCodexTurn({ sessionId: session.id, cwd: session.cwd, model: session.model, runtimeMode: session.runtimeMode, codexStore: "mono", providerAccountId: "account",
      text: "Exact held prompt", intent: session.queuedMessages?.[0]?.intent, attachments: [], onAccepted: accepted, onEvent() {} });
    return true;
  });
  const saveMode = vi.fn((id: string, mode: string) => modes.set(id, mode));
  const persist = vi.fn(async (session: Session) => { persisted.set(session.id, structuredClone(session)); });
  const invoke = vi.fn(async () => ({ configPath: join(base,"config.toml"), backupPaths: [join(base,"config.backup")] }));
  const repair = repairCallback({ sessionsRef, codexStorageRecovery: { current: recovery }, codexStorageAccountId, isCodexStorageError,
    parseCodexStorageConflict, parseCodexStorageRecoveryConflict, parseCodexSandboxBlocker, codexSandboxRepairSettings, codexFullAccessRepairAllowed, IS_WIN: true,
    selectedProviderAccountId: () => "account", remoteProjectFor: () => undefined, queuedHead: () => undefined,
    monoSkillsForSession: () => ({ skillsRole: "manager", skillsPolicy: { mode: "role" } }), sessionWorkCwd: (session: Session) => session.cwd,
    orchestrator: { forSession: () => undefined }, monoForSession: () => ({ id:"mono-clicked" }), saveMonoRuntimeMode: saveMode, upsertSession: persist,
    stopHarnessSession: async (_harness:string,id:string) => stopCodexSession(id), prepareCodexMonoContext, prepareMonoCodexStore:mock.prepare,
    resolveCodexBinary: async () => ({path: input.path}), checkMonoCodexSandbox: mock.check, invoke, crypto: { randomUUID: () => "synthetic-receipt" }, flushSync: (action: () => void) => action(),
    setSessions: (update: (sessions:Session[]) => Session[]) => { sessionsRef.current = update(sessionsRef.current); }, setQueueDispatchVersion: vi.fn(), setCodexStorageRepaired: vi.fn() });
  return { repair, sessionsRef, persisted, modes, recovery, accepted, saveMode, persist, invoke };
}

it.each(["plan","orchestrate","readonly"] as const)("actual App/store/provider refuses ineffective %s Full access without a persistent change or accepted turn", async mode => {
  const fixture = connectedRepair(mode === "readonly" ? { readOnly:true } : { queuedMessages:[{id:"held",text:"Exact held prompt",attachments:[],intent:mode}] });
  await expect(fixture.repair("clicked","use_mono_full_access")).rejects.toThrow("restrictions");
  expect(fixture.persist).not.toHaveBeenCalled(); expect(fixture.saveMode).not.toHaveBeenCalled(); expect(fixture.accepted).not.toHaveBeenCalled();
  expect(fixture.persisted.get("clicked")?.runtimeMode).toBe("supervised"); expect(fixture.modes.get("mono-clicked")).toBe("supervised");
  expect(fixture.recovery.hasPending("clicked")).toBe(true);
  expect(mock.sent.some(request => ["thread/start","thread/resume","turn/start"].includes(request.method))).toBe(false);
});

it("actual failed store readiness leaves persisted Full access unchanged and accepts no provider turn", async () => {
  const fixture = connectedRepair(); mock.check.mockRejectedValueOnce(new Error(BLOCKER));
  await expect(fixture.repair("clicked","use_mono_full_access")).rejects.toThrow("cannot unlock");
  expect(fixture.persist).not.toHaveBeenCalled(); expect(fixture.saveMode).not.toHaveBeenCalled(); expect(fixture.accepted).not.toHaveBeenCalled();
  expect(fixture.persisted.get("clicked")?.runtimeMode).toBe("supervised"); expect(fixture.modes.get("mono-clicked")).toBe("supervised");
  expect(mock.sent.some(request => ["thread/start","thread/resume","turn/start"].includes(request.method))).toBe(false);
  expect(readFileSync(join(source,"config.toml"),"utf8")).toBe(SOURCE);
});

it("actual explicit Elevated repair gives Permissions guidance without native repair or accepted turns", async () => {
  const fixture = connectedRepair({ windowsSandbox:"elevated" });
  await expect(fixture.repair("clicked","use_unelevated_sandbox")).rejects.toThrow("In Permissions");
  expect(fixture.invoke).not.toHaveBeenCalled(); expect(fixture.accepted).not.toHaveBeenCalled(); expect(fixture.persist).not.toHaveBeenCalled();
  expect(fixture.sessionsRef.current[0].blocks).toEqual([]); expect(mock.sent).toEqual([]);
});

it("actual successful Full access persists only after readiness and resumes the provider exactly once", async () => {
  const fixture = connectedRepair(); await fixture.repair("clicked","use_mono_full_access");
  expect(fixture.persist).toHaveBeenCalledOnce(); expect(fixture.saveMode).toHaveBeenCalledExactlyOnceWith("mono-clicked","full-access");
  expect(fixture.persisted.get("clicked")?.runtimeMode).toBe("full-access"); expect(fixture.modes.get("mono-clicked")).toBe("full-access");
  expect(mock.check.mock.invocationCallOrder[0]).toBeLessThan(fixture.persist.mock.invocationCallOrder[0]);
  expect(fixture.accepted).toHaveBeenCalledOnce(); expect(mock.sent.filter(request => request.method === "turn/start")).toHaveLength(1);
  expect(fixture.recovery.hasPending("clicked")).toBe(false);
});
