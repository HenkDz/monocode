// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import ts from "typescript";
import { beforeEach, expect, it, vi } from "vitest";
import { applyHarnessEvent, applyHarnessEvents } from "../integrations/harness/core/apply";
import { bindTurnContextProfile } from "../integrations/harness/core/contextProfile";
import type { HarnessEvent } from "../integrations/harness/core/types";
import { HarnessEventQueue } from "./model/harnessFlush";
import { dropContextWindow } from "../features/sessions/model/contextUsage";
import { supportsProviderAccounts } from "../features/providers/model/providerAccounts";
import {
  formatSessionTitle,
  HARNESS_LABEL,
  newSession,
  retargetSessionToProject,
  sessionDisplayTitle,
  type HarnessId,
  type Session,
} from "../features/sessions/model/session";

// Exercise the actual private App helpers without starting a native workspace.
const source = ts.createSourceFile(
  "App.tsx",
  readFileSync("src/app/App.tsx", "utf8"),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
function findNode(predicate: (node: ts.Node) => boolean): ts.Node {
  let found: ts.Node | undefined;
  function visit(node: ts.Node) {
    if (predicate(node)) found = node;
    else if (!found) ts.forEachChild(node, visit);
  }
  visit(source);
  if (!found) throw Error("App context helper was not found");
  return found;
}
const sameSettings = findNode(
  (node) =>
    ts.isFunctionDeclaration(node) && node.name?.text === "sameSettings",
).getText(source);
const choice = findNode(
  (node) =>
    ts.isFunctionDeclaration(node) && node.name?.text === "withHarnessChoice",
).getText(source);
const withHarnessChoice = new Function(
  "HARNESS_LABEL",
  "formatSessionTitle",
  "sessionDisplayTitle",
  "dropContextWindow",
  ts.transpile(`${sameSettings}\n${choice}\nreturn withHarnessChoice;`, {
    target: ts.ScriptTarget.ES2022,
  }),
)(
  HARNESS_LABEL,
  formatSessionTitle,
  sessionDisplayTitle,
  dropContextWindow,
) as (
  session: Session,
  harness: HarnessId,
  model: string,
  settings: Record<string, string>,
) => Session;
const settingsDeclaration = findNode(
  (node) =>
    ts.isVariableDeclaration(node) &&
    node.name.getText(source) === "onModelSettingsChange",
) as ts.VariableDeclaration;
const settingsCallback = (
  settingsDeclaration.initializer as ts.CallExpression
).arguments[0].getText(source);
const turnEventCallback = (findNode(
  node => ts.isVariableDeclaration(node) && node.name.getText(source) === "applyTurnEvent",
) as ts.VariableDeclaration).initializer!.getText(source);
const profileBinding = (findNode(
  node => ts.isVariableDeclaration(node) && node.name.getText(source) === "bindContextProfile",
) as ts.VariableDeclaration).initializer!.getText(source);

beforeEach(() => localStorage.clear());

function resident(): Session {
  return {
    ...newSession("codex", "/synthetic"),
    id: "retained-task",
    model: "codex:fixture",
    modelSettings: { reasoningEffort: "high", serviceTier: "default" },
    effortSource: "user",
    providerSessionId: "old-thread",
    providerAccountId: "locked-account",
    context: {
      used: 150_000,
      window: 200_000,
      effectiveCompactionThreshold: 180_000,
    },
    blocks: [
      {
        id: "original-user-turn",
        role: "user",
        text: "Keep the checkout and do not merge.",
      },
    ],
  };
}

it("retains known limits for an unchanged profile regardless of setting order", () => {
  const previous = resident();
  const next = withHarnessChoice(previous, previous.harness, previous.model, {
    serviceTier: "default",
    reasoningEffort: "high",
  });
  expect(next.context).toBe(previous.context);
  expect(next.providerSessionId).toBe("old-thread");
  expect(next.providerAccountId).toBe("locked-account");
});

it.each([
  { reasoningEffort: "medium", serviceTier: "default" },
  { reasoningEffort: "high", serviceTier: "fast" },
])(
  "invalidates both model limits after same-model settings change: %j",
  (settings) => {
    const previous = resident();
    const next = withHarnessChoice(
      previous,
      previous.harness,
      previous.model,
      settings,
    );
    expect(next.context).toEqual({ used: 150_000 });
    expect(next.id).toBe(previous.id);
    expect(next.cwd).toBe(previous.cwd);
    expect(next.blocks).toBe(previous.blocks);
    expect(next.effortSource).toBe("user");
    expect(next.providerAccountId).toBe("locked-account");
  },
);

it("invalidates both limits when the harness changes with the same model name", () => {
  const previous = resident();
  const next = withHarnessChoice(
    previous,
    "claude",
    previous.model,
    previous.modelSettings,
  );
  expect(next.context).toEqual({ used: 150_000 });
  expect(next.providerSessionId).toBeUndefined();
  expect(next.providerAccountId).toBeUndefined();
  expect(next.blocks).toBe(previous.blocks);
});

it("invalidates both limits when the model changes", () => {
  const previous = resident();
  const next = withHarnessChoice(
    previous,
    previous.harness,
    "codex:other",
    previous.modelSettings,
  );
  expect(next.context).toEqual({ used: 150_000 });
  expect(next.providerAccountId).toBe("locked-account");
});

it("keeps an unreported threshold unknown for an unchanged profile", () => {
  const previous = {
    ...resident(),
    context: { used: 150_000, window: 200_000 },
  };
  const next = withHarnessChoice(
    previous,
    previous.harness,
    previous.model,
    previous.modelSettings,
  );
  expect(next.context).toBe(previous.context);
  expect(next.context).not.toHaveProperty("effectiveCompactionThreshold");
});

function changeSettings(previous: Session, settings: Record<string, string>) {
  const untouched = { ...resident(), id: "other-session" };
  const sessionsRef = { current: [previous, untouched] };
  let state = sessionsRef.current;
  const callback = new Function(
    "sessionsRef",
    "monoForSession",
    "modelEffortSetting",
    "resolveModel",
    "updateMono",
    "lockMonoField",
    "saveLastModelSettings",
    "setSessions",
    "dropContextWindow",
    ts.transpile(`${sameSettings}\nreturn ${settingsCallback};`, {
      target: ts.ScriptTarget.ES2022,
    }),
  )(
    sessionsRef,
    () => undefined,
    () => undefined,
    vi.fn(),
    vi.fn(),
    vi.fn(),
    vi.fn(),
    (update: (sessions: Session[]) => Session[]) => {
      state = update(state);
    },
    dropContextWindow,
  ) as (sessionId: string, settings: Record<string, string>) => void;
  callback(previous.id, settings);
  expect(sessionsRef.current[1]).toBe(untouched);
  expect(state[1]).toBe(untouched);
  return { current: sessionsRef.current[0], rendered: state[0] };
}

it("invalidates limits in both the live ref and rendered state after a settings change", () => {
  const previous = resident();
  const changed = changeSettings(previous, {
    ...previous.modelSettings,
    serviceTier: "fast",
  });
  for (const next of [changed.current, changed.rendered]) {
    expect(next.context).toEqual({ used: 150_000 });
    expect(next.blocks).toBe(previous.blocks);
    expect(next.providerAccountId).toBe("locked-account");
    expect(next.effortSource).toBe("user");
  }
});

it("retains known limits when the settings callback receives an unchanged profile", () => {
  const previous = resident();
  const unchanged = changeSettings(previous, { ...previous.modelSettings });
  expect(unchanged.current.context).toBe(previous.context);
  expect(unchanged.rendered.context).toBe(previous.context);
});

function routeTurnEvents(previous: Session, enqueueHarnessEvent: (id: string, event: HarnessEvent) => void, providerAccountId = previous.providerAccountId) {
  const scope = {
    current: previous,
    providerAccountId,
    bindTurnContextProfile,
    sessionId: previous.id,
    orchestrator: { observe: vi.fn(), forSession: () => true },
    options: undefined,
    wrap: undefined,
    workCwd: previous.cwd,
    nudgeOpenEditors: vi.fn(),
    routePlanEvent: (event: HarnessEvent) => event,
    enqueueHarnessEvent,
  };
  return new Function(...Object.keys(scope), ts.transpile(
    `const bindContextProfile = ${profileBinding}; return ${turnEventCallback};`,
    { target: ts.ScriptTarget.ES2022 },
  ))(...Object.values(scope)) as (event: HarnessEvent) => void;
}

it("tags main-turn bindings with the resolved submission account", () => {
  const previous = { ...resident(), providerAccountId: undefined };
  const events: HarnessEvent[] = [];
  routeTurnEvents(previous, (_id, event) => events.push(event), "selected-account")({ type: "session.providerBound", providerSessionId: "selected-native" });
  expect(applyHarnessEvents({ ...previous, providerAccountId: "selected-account" }, events).providerSessionId).toBe("selected-native");
  expect(applyHarnessEvents(previous, events).providerSessionId).toBe(previous.providerSessionId);
});

it.each(["same account", "old harness", "old account", "selected account differs from legacy"])(
  "actual compaction finally flush preserves binding provenance with %s", async choice => {
    const previous = { ...resident(), providerAccountId: choice === "selected account differs from legacy" ? undefined : "work" };
    const sessionsRef: { current: Session[] } = { current: [previous] };
    const queue = new HarnessEventQueue(() => false, batches => {
      sessionsRef.current = sessionsRef.current.map(session => applyHarnessEvents(session, batches.get(session.id) ?? []));
    });
    let finish!: () => void;
    const saving = new Promise<void>(resolve => { finish = resolve; });
    const compactHarnessContext = vi.fn(async (input: { providerAccountId?: string; onEvent: (event: HarnessEvent) => void }) => {
      input.onEvent({ type: "session.providerBound", providerSessionId: "compact-native" });
      await saving;
    });
    const scope = {
      sessionsRef, remoteProjectFor: () => undefined, canCompactHarnessContext: () => true,
      turnGen: { current: new Map<string, number>() }, sessionWorkCwd: () => previous.cwd,
      supportsProviderAccounts, selectedProviderAccountId: () => "work", bindTurnContextProfile,
      applyHarnessEvent, syncDockBadge: vi.fn(), setSessions: vi.fn(), compactHarnessContext,
      monoSkillsForSession: () => ({}), isMonoSession: () => true,
      enqueueHarnessEvent: queue.enqueue, flushHarnessEvents: queue.flush,
    };
    const declaration = findNode(node => ts.isVariableDeclaration(node) && node.name.getText(source) === "onCompactContext") as ts.VariableDeclaration;
    const compact = new Function(...Object.keys(scope), ts.transpile(
      `return ${(declaration.initializer as ts.CallExpression).arguments[0].getText(source)};`, { target: ts.ScriptTarget.ES2022 },
    ))(...Object.values(scope)) as (id: string) => boolean;
    expect(compact(previous.id)).toBe(true);
    expect(compactHarnessContext.mock.calls[0][0].providerAccountId).toBe("work");
    const current = sessionsRef.current[0];
    sessionsRef.current = [choice === "old harness"
      ? withHarnessChoice(current, "claude", "claude:sonnet", {})
      : choice === "old account" ? { ...current, providerAccountId: "other", providerSessionId: undefined }
      : { ...current, model: "next-model", modelSettings: { effort: "high" }, runtimeMode: "supervised" }];
    const changed = sessionsRef.current[0];
    finish();
    try {
      for (let step = 0; step < 10; step++) await Promise.resolve();
      expect(sessionsRef.current[0]).toEqual({ ...changed, busy: false,
        blocks: [...changed.blocks, expect.objectContaining({ role: "system", text: "Compacted context" })],
        providerSessionId: choice === "same account" ? "compact-native" : changed.providerSessionId });
    } finally { queue.cancelScheduled(); }
  },
);

it.each(["model", "settings"])("rejects late %s limits while preserving active-turn output and occupancy", change => {
  const previous = { ...resident(), busy: true, blocks: resident().blocks.map(block => ({ ...block, startedAt: 1 })) };
  const events: HarnessEvent[] = [];
  const route = routeTurnEvents(previous, (_id, event) => events.push(event));
  const changed = change === "settings"
    ? changeSettings(previous, { ...previous.modelSettings, serviceTier: "fast" }).current
    : withHarnessChoice(previous, previous.harness, "codex:smaller", previous.modelSettings);
  route({ type: "context", used: 700_000, window: 1_000_000, effectiveCompactionThreshold: 900_000 });
  route({ type: "message.delta", text: "Output from the active turn" });
  route({ type: "context.compacted" });
  route({ type: "turn.compaction", phase: "completed", id: "compaction-1" });
  route({ type: "turn.metrics", modelCallId: "model-call-1", inputTokens: 100, outputTokens: 20 });
  const next = applyHarnessEvents(changed, events);
  expect(next.context).toEqual({ used: 700_000 });
  expect(next.blocks[next.blocks.length - 1]?.text).toBe("Output from the active turn");
  expect(next.busy).toBe(true);
  expect(next.blocks[0].turnMetrics).toMatchObject({
    firstTokenAt: expect.any(Number), inputTokens: 100, outputTokens: 20, modelCalls: 1,
    compactions: [{ id: "compaction-1", endedAt: expect.any(Number) }],
  });
  expect(events.map(event => event.type)).toEqual([
    "context", "message.delta", "context.compacted", "turn.compaction", "turn.metrics",
  ]);
});

it("rejects old limits that were queued before the settings callback invalidated them", () => {
  const previous = { ...resident(), busy: true };
  let current: Session = previous;
  const queue = new HarnessEventQueue(() => false, batches => {
    current = applyHarnessEvents(current, batches.get(previous.id)!);
  });
  const route = routeTurnEvents(previous, queue.enqueue);
  route({ type: "context", used: 700_000, window: 1_000_000 });
  current = changeSettings(previous, { ...previous.modelSettings, reasoningEffort: "medium" }).current;
  expect(current.context).toEqual({ used: 150_000 });
  queue.flush();
  expect(current.context).toEqual({ used: 700_000 });
});

it("accepts limits from the next turn with the newly selected profile", () => {
  const previous = resident();
  const current = changeSettings(previous, { ...previous.modelSettings, serviceTier: "fast" }).current;
  const events: HarnessEvent[] = [];
  const route = routeTurnEvents(current, (_id, event) => events.push(event));
  route({ type: "context", window: 100_000 });
  route({ type: "context", used: 40_000, effectiveCompactionThreshold: 80_000 });
  expect(applyHarnessEvents(current, events).context).toEqual({
    used: 40_000, window: 100_000, effectiveCompactionThreshold: 80_000,
  });
});

it("keeps canonical provider model/settings updates and their queued context limits together", () => {
  const current = resident();
  const events: HarnessEvent[] = [];
  const route = routeTurnEvents(current, (_id, event) => events.push(event));
  route({ type: "session.configChanged", model: "codex:canonical", modelSettings: { serviceTier: "default-normalized" } });
  route({ type: "context", window: 120_000, effectiveCompactionThreshold: 100_000 });
  const next = applyHarnessEvents(current, events);
  expect(next.model).toBe("codex:canonical");
  expect(next.modelSettings).toEqual({ reasoningEffort: "high", serviceTier: "default-normalized" });
  expect(next.context).toEqual({ used: 150_000, window: 120_000, effectiveCompactionThreshold: 100_000 });
});

it("does not let an old provider configuration override the user's changed selection", () => {
  const previous = resident();
  const events: HarnessEvent[] = [];
  const route = routeTurnEvents(previous, (_id, event) => events.push(event));
  route({ type: "session.configChanged", model: "codex:old-canonical", modelSettings: { serviceTier: "default-normalized" } });
  route({ type: "context", used: 700_000, window: 1_000_000 });
  const current = changeSettings(previous, { ...previous.modelSettings, serviceTier: "fast" }).current;
  const next = applyHarnessEvents(current, events);
  expect(next.model).toBe(current.model);
  expect(next.modelSettings).toBe(current.modelSettings);
  expect(next.context).toEqual({ used: 700_000 });
});

it("invalidates project-specific limits when retargeting to another checkout", () => {
  const previous = { ...resident(), model: "codex:gpt-6.1-sol" };
  const next = retargetSessionToProject(previous, "/synthetic/other");
  expect(next.context).toEqual({ used: 150_000 });
  expect(next.id).toBe(previous.id);
  expect(next.model).toBe(previous.model);
  expect(next.blocks).toBe(previous.blocks);
  expect(next.providerAccountId).toBe("locked-account");
});

it("retains limits when retargeting keeps the same checkout, harness and model", () => {
  const previous = { ...resident(), model: "codex:gpt-6.1-sol" };
  const next = retargetSessionToProject(previous, previous.cwd!);
  expect(next.context).toBe(previous.context);
});
