// @vitest-environment happy-dom
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { WorkbenchSessionDetails } from "./WorkbenchSessionDetails";
import { newSession, type Session } from "../../sessions/model/session";
import type { Mono } from "../model/mono";
import type { MemberDetails } from "./MonoTeamPage";
import { WorkbenchTask } from "./WorkbenchTask";
import { orchestrator, type OrchestrationRun } from "../../orchestration/model/orchestration";
import * as cards from "../model/monoCards";

vi.mock("./MonoTeamPage", () => ({ MemberDetails: (props: ComponentProps<typeof MemberDetails>) => <>
  <p>{props.readOnly ? "This task stays read-only." : "Writable task"}</p>
  <p>{props.runtimeModeSource === "role" ? "Role permissions" : "User permissions"}</p>
  <p>{props.windowsSandbox ?? "Account sandbox"}</p>
  <button type="button" onClick={() => props.onProfileChange?.({ ...props.fallback, modelSettings: { reasoningEffort: "high" } }, "role")}>Use role effort</button>
  <button type="button" onClick={() => props.onRuntimeModeChange?.("auto", "role")}>Use role permissions</button>
  <button type="button" disabled={props.busy} onClick={() => void props.onWindowsSandboxChange?.("unelevated")}>Use unelevated sandbox</button>
</> }));

let host: HTMLDivElement, root: Root;
const clock = 100_000;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  vi.setSystemTime(clock);
  host = document.createElement("div");
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function session(patch: Partial<Session> = {}): Session {
  return {
    ...newSession("codex", "C:/synthetic/project"),
    worktreeCwd: "C:/synthetic/worker",
    blocks: [{
      id: "turn", role: "user", text: "Review", startedAt: 1000, durationMs: 97_000,
      turnModel: { harness: "codex", id: "fixture", name: "Fixture" },
      turnMetrics: { inputTokens: 326_569, cacheReadTokens: 289_408, outputTokens: 2318, endedAt: 98_000 },
    }],
    ...patch,
  };
}

function render(value = session(), member?: Mono) {
  const actions = { onModelChange: vi.fn(), onSettingsChange: vi.fn(), onAccessChange: vi.fn(), onSandboxChange: vi.fn() };
  act(() => root.render(<WorkbenchSessionDetails session={value} onClose={vi.fn()}
    member={member} {...actions} />));
  return actions;
}

function fact(label: string) {
  return [...host.querySelectorAll("dt")].find(item => item.textContent === label)?.nextElementSibling?.textContent;
}

it("opens the owning Manager through the existing navigation callback for a task/session fault", () => {
  const task: OrchestrationRun["tasks"][number] = { id: "task", sessionId: "worker", memberId: "member", title: "Review", prompt: "Review", status: "failed", harness: "codex", model: "", files: [], scopes: [], dependsOn: [], result: "", accepted: false, delivered: false, error: "task/session state mismatch" };
  const snapshot = vi.spyOn(orchestrator, "snapshot").mockReturnValue([{ version: 2, leadId: "manager", ownerSessionId: "manager", cwd: "C:/synthetic", status: "paused", allowedHarnesses: ["codex"], maxWorkers: 1, cli: "synthetic", continuations: 0, requests: {}, tasks: [task] }]);
  const open = vi.spyOn(cards, "openCardSession").mockImplementation(() => {});
  try {
    act(() => root.render(<WorkbenchTask task={task} />));
    expect(host.querySelector('[data-transcript-error="sync"]')).not.toBeNull();
    expect(host.textContent).toContain("something got out of sync");
    const button = [...host.querySelectorAll("button")].find(button => button.textContent === "Open Manager");
    expect(button).toBeDefined();
    act(() => button!.click());
    expect(open).toHaveBeenCalledExactlyOnceWith("manager");
  } finally { snapshot.mockRestore(); open.mockRestore(); }
});

it("shows exact last-turn counters with cached input included in the input total once", () => {
  const value = session();
  value.blocks.unshift({ ...value.blocks[0], id: "earlier", startedAt: 1,
    turnMetrics: { inputTokens: 9_000_000, cacheReadTokens: 8_000_000, outputTokens: 9000 },
  });
  value.blocks.push({ ...value.blocks[1], id: "queued", startedAt: clock,
    turnMetrics: { inputTokens: 999_999, outputTokens: 1000 },
  });
  value.queuedMessages = [{ id: "queued-message", blockId: "queued", text: "Later", attachments: [] }];
  render(value);
  expect(fact("Timing scope")).toBe("Last conversation turn");
  expect(fact("Elapsed")).toBe("1m 37s");
  expect(fact("Input tokens · including cache")).toBe("326,569");
  expect(fact("Cached input · included above")).toBe("289,408");
  expect(fact("Output tokens")).toBe("2,318");
  expect(host.textContent).not.toContain("615,977");
  expect(host.textContent).not.toContain("9,000,000");
  expect(host.textContent).toContain("C:/synthetic/worker");
});

it("keeps recorded zero counters distinct from unavailable timing", () => {
  render(session({ blocks: [{ id: "zero", role: "user", text: "Check",
    turnModel: { harness: "codex", id: "fixture", name: "Fixture" },
    turnMetrics: { inputTokens: 0, cacheReadTokens: 0, outputTokens: 0 },
  }] }));
  expect(fact("Timing scope")).toBe("Last conversation turn");
  expect(fact("Elapsed")).toBe("Unavailable");
  expect(fact("Input tokens · including cache")).toBe("0");
  expect(fact("Cached input · included above")).toBe("0");
  expect(fact("Output tokens")).toBe("0");
});

it("reports no recorded turn without inventing zero counters or elapsed time", () => {
  render(session({ blocks: [] }));
  expect(fact("Timing scope")).toBe("No conversation turn recorded");
  for (const label of ["Elapsed", "Input tokens · including cache", "Cached input · included above", "Output tokens"])
    expect(fact(label)).toBe("Unavailable");
});

it("does not borrow a previous turn's timestamps when a later turn only records counters", () => {
  const value = session();
  value.blocks.push({ id: "later", role: "user", text: "Another review",
    turnModel: { harness: "codex", id: "fixture", name: "Fixture" },
    turnMetrics: { inputTokens: 500, outputTokens: 0 },
  });
  render(value);
  expect(fact("Timing scope")).toBe("Last conversation turn");
  expect(fact("Elapsed")).toBe("Unavailable");
  expect(fact("Input tokens · including cache")).toBe("500");
  expect(fact("Cached input · included above")).toBe("Unavailable");
  expect(fact("Output tokens")).toBe("0");
  expect(host.textContent).not.toContain("1m 37s");
});

it("uses the recorded active turn start while keeping unknown cache unavailable", () => {
  render(session({ busy: true, blocks: [{ id: "current", role: "user", text: "Review",
    startedAt: clock - 2000, turnModel: { harness: "codex", id: "fixture", name: "Fixture" },
    turnMetrics: { inputTokens: 100, outputTokens: 0 },
  }] }));
  expect(fact("Timing scope")).toBe("Current conversation turn");
  expect(fact("Elapsed")).toBe("2s");
  expect(fact("Input tokens · including cache")).toBe("100");
  expect(fact("Cached input · included above")).toBe("Unavailable");
});

it("does not turn an incomplete saved turn into a running clock", () => {
  render(session({ busy: false, blocks: [{ id: "saved", role: "user", text: "Review", startedAt: 1000,
    turnModel: { harness: "codex", id: "fixture", name: "Fixture" },
    turnMetrics: { inputTokens: 100, outputTokens: 0 },
  }] }));
  expect(fact("Timing scope")).toBe("Last conversation turn");
  expect(fact("Elapsed")).toBe("Unavailable");
  expect(host.textContent).toContain("Recorded metrics only; some counters are unavailable.");
  act(() => vi.advanceTimersByTime(20_000));
  expect(fact("Elapsed")).toBe("Unavailable");
});

const member: Mono = { id: "reviewer", role: "member", mascot: "cat", color: "#888", projects: ["C:/synthetic/project"] };
const control = (label: string) => [...host.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === label)!;

it("preserves role ownership when resetting effort without changing the model", () => {
  const actions = render(session({ effortSource: "user" }), member);
  act(() => control("Use role effort").click());
  expect(actions.onSettingsChange).toHaveBeenCalledExactlyOnceWith({ reasoningEffort: "high" }, "role");
  expect(actions.onModelChange).not.toHaveBeenCalled();
});

it("preserves role ownership when resetting permissions", () => {
  const actions = render(session({ runtimeMode: "full-access", runtimeModeSource: "user" }), member);
  act(() => control("Use role permissions").click());
  expect(actions.onAccessChange).toHaveBeenCalledExactlyOnceWith("auto", "role");
});

it("keeps the current conversation's read-only and busy sandbox guards", () => {
  const actions = render(session({ readOnly: true, busy: true, windowsSandbox: "unelevated", runtimeModeSource: "role" }), member);
  expect(host.textContent).toContain("This task stays read-only.");
  expect(host.textContent).toContain("Role permissions");
  expect(host.textContent).toContain("unelevated");
  expect(control("Use unelevated sandbox").disabled).toBe(true);
  act(() => control("Use unelevated sandbox").click());
  expect(actions.onSandboxChange).not.toHaveBeenCalled();
});

it("routes an idle conversation's sandbox change through the supplied action", () => {
  const actions = render(session({ busy: false }), member);
  act(() => control("Use unelevated sandbox").click());
  expect(actions.onSandboxChange).toHaveBeenCalledExactlyOnceWith("unelevated");
});
