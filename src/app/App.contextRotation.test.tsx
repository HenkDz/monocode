// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import ts from "typescript";
import { beforeEach, expect, it, vi } from "vitest";
import { dropContextWindow } from "../features/sessions/model/contextUsage";
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
