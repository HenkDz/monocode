// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AttentionQueueNav, AttentionQueueView, type AttentionQueueViewProps } from "./AttentionQueue";
import { MissionControlView } from "./MissionControl";
import { syntheticAttention } from "../fixtures/attention/syntheticAttention";
import { goals, roster, runs, sessions, now } from "../fixtures/syntheticMission";
import { selectGoalViews } from "../model/goalView";
import type { AttentionCallbacks, AttentionInput } from "../model/attention";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }));

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});
const inputFor = (...ids: string[]): AttentionInput => {
  const input = syntheticAttention();
  return { ...input, sessions: input.sessions.filter(session => ids.includes(session.id)), runs: [] };
};
const callbacks = (): AttentionCallbacks => ({ approval: vi.fn(), question: vi.fn(), questionInteraction: vi.fn(),
  repair: vi.fn(async () => {}), resume: vi.fn(), resumeAtReset: vi.fn(), retryDelivery: vi.fn(),
  continueManager: vi.fn(async () => {}), inspect: vi.fn() });
const buttons = (scope: ParentNode = host) => [...scope.querySelectorAll<HTMLButtonElement>("button")];
const button = (label: string, scope: ParentNode = host) => buttons(scope).find(button => button.textContent?.trim().startsWith(label))!;
const rows = () => [...host.querySelectorAll<HTMLElement>(".aq-item")];
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
};

describe("Attention queue", () => {
  it("omits unknown panel ages while keeping full-page coverage explicit and recorded ages visible", async () => {
    const input = inputFor("storage", "manager");
    await act(async () => root.render(<AttentionQueueView input={input} callbacks={callbacks()} open onClose={() => {}} presentation="panel" />));
    expect(host.querySelector('[data-attention-source="storage"] .aq-time')).toBeNull();
    expect(host.querySelector('[data-attention-source="approval"] .aq-time')?.textContent).toMatch(/\d+[hm] \d+[ms]/);
    await act(async () => root.render(<AttentionQueueView input={input} callbacks={callbacks()} open onClose={() => {}} />));
    expect(host.querySelector('[data-attention-source="storage"] .aq-time')?.textContent).toBe("Age unavailable");
  });
  it("shows actionable sandbox setup inline in the Mission control panel and passes explicit account choices", async () => {
    const input = inputFor("storage"), calls = callbacks();
    const setupCommand = "$env:CODEX_HOME = 'C:/synthetic/account'; codex sandbox -P :workspace -- echo ready";
    input.sessions = input.sessions.map(session => ({ ...session, codexStorageError: `Codex storage needs repair: ${JSON.stringify({ sandbox: true, reason: "Sandbox proxy ports changed", setupCommand })}` }));
    await act(async () => root.render(<AttentionQueueView input={input} callbacks={calls} open onClose={() => {}} presentation="panel" />));
    expect(rows()[0].querySelector("h2")?.textContent).toBe("Codex sandbox needs setup");
    expect(rows()[0].textContent).toContain("Sandbox proxy ports changed");
    expect(rows()[0].querySelector('[aria-label="Sandbox setup command"]')?.textContent).toBe(setupCommand);
    expect(rows()[0].querySelector("[data-attention-details]")).toBeNull();
    expect(calls.repair).not.toHaveBeenCalled();
    await act(async () => button("Switch this account to unelevated").click());
    expect(calls.repair).toHaveBeenCalledExactlyOnceWith("storage", "use_unelevated_sandbox");
  });

  it("passes explicit full access from the sandbox blocker only for the selected conversation", async () => {
    const input = inputFor("storage", "storage-peer"), calls = callbacks();
    input.sessions = input.sessions.map(session => ({ ...session, codexStorageError: `Codex storage needs repair: ${JSON.stringify({ sandbox: true, reason: "Sandbox account missing", setupCommand: "codex sandbox -P :workspace -- echo ready" })}` }));
    await act(async () => root.render(<AttentionQueueView input={input} callbacks={calls} open onClose={() => {}} />));
    await act(async () => button("Use full access for this Mono").click());
    expect(calls.repair).toHaveBeenCalledExactlyOnceWith("storage", "use_mono_full_access");
  });

  it("keeps worker approvals and questions with the lead while exposing a separate escalation", async () => {
    const input = inputFor("worker", "decision");
    input.sessions = input.sessions.map(session => session.id === "worker"
      ? { ...session, pendingQuestion: { ...input.sessions.find(session => session.id === "decision")!.pendingQuestion!, title: "Worker question" } }
      : session);
    await act(async () => root.render(<AttentionQueueView input={input} callbacks={callbacks()} open onClose={() => {}} />));
    const worker = rows().filter(row => row.textContent?.includes("Routed through lead"));
    expect(worker).toHaveLength(2);
    for (const row of worker) {
      expect(row.querySelector("[data-question-form]")).toBeNull();
      expect(buttons(row).map(button => button.textContent)).toEqual(["Open lead"]);
    }
    expect(host.querySelectorAll("[data-question-form]")).toHaveLength(1);
    expect(buttons().some(button => button.textContent === "Allow once")).toBe(false);
  });

  it("passes a structured multi-select answer through the real question form", async () => {
    const input = inputFor("decision"), calls = callbacks();
    const prompt = input.sessions[0].pendingQuestion!;
    input.sessions = [{ ...input.sessions[0], pendingQuestion: { ...prompt, autoResolveAt: Date.now() + 120_000,
      questions: [{ ...prompt.questions[0], multiSelect: true }] } }];
    await act(async () => root.render(<AttentionQueueView input={input} callbacks={calls} open onClose={() => {}} />));
    expect(button("Continue").disabled).toBe(true);
    await act(async () => button("Focused checks").click());
    await act(async () => button("Full suite").click());
    await act(async () => button("Continue").click());
    expect(calls.question).toHaveBeenCalledExactlyOnceWith("decision", 81,
      { kind: "answered", answers: { scope: ["focused", "full"] } });
    expect(calls.questionInteraction).toHaveBeenCalledWith("decision", 81);
    expect(host.textContent).toContain("awaiting source acknowledgement");
    expect(rows()[0].querySelector<HTMLFieldSetElement>("fieldset")?.disabled).toBe(true);
  });

  it("prevents duplicate approval submissions while pending and awaiting source acknowledgement", async () => {
    const calls = callbacks(), pending = deferred();
    calls.approval = vi.fn(() => pending.promise);
    await act(async () => root.render(<AttentionQueueView input={inputFor("manager")} callbacks={calls} open onClose={() => {}} />));
    await act(async () => { button("Allow once").click(); button("Allow once").click(); });
    expect(calls.approval).toHaveBeenCalledExactlyOnceWith("manager", 71, "allow");
    expect(rows()[0].getAttribute("aria-busy")).toBe("true");
    expect(button("Allow once").disabled).toBe(true);
    expect(button("Deny").disabled).toBe(true);
    expect(host.querySelector('[role="status"]')?.textContent).toContain("pending");
    await act(async () => pending.resolve());
    expect(rows()[0].getAttribute("data-attention-status")).toBe("open");
    expect(button("Allow once").disabled).toBe(true);
    await act(async () => button("Allow once").click());
    expect(calls.approval).toHaveBeenCalledOnce();
  });

  it("blocks a second structured answer while its first answer is pending", async () => {
    const calls = callbacks(), pending = deferred();
    calls.question = vi.fn(() => pending.promise);
    await act(async () => root.render(<AttentionQueueView input={inputFor("decision")} callbacks={calls} open onClose={() => {}} />));
    await act(async () => button("Focused checks").click());
    await act(async () => { button("Continue").click(); button("Skip").click(); });
    expect(calls.question).toHaveBeenCalledOnce();
    expect(rows()[0].querySelector<HTMLFieldSetElement>("fieldset")?.disabled).toBe(true);
    await act(async () => pending.resolve());
  });

  it("uses the storage notice's explicit resolution and disables duplicate repair", async () => {
    const calls = callbacks(), pending = deferred();
    calls.repair = vi.fn(() => pending.promise);
    await act(async () => root.render(<AttentionQueueView input={inputFor("storage", "storage-peer")} callbacks={calls} open onClose={() => {}} />));
    expect(rows()).toHaveLength(1);
    expect(host.textContent).toContain("Affects 2 conversations");
    await act(async () => { button("Use account version").click(); button("Keep MonoCode version").click(); });
    expect(calls.repair).toHaveBeenCalledExactlyOnceWith("storage", "use_account_version");
    expect(rows()[0].querySelector<HTMLFieldSetElement>("fieldset")?.disabled).toBe(true);
    await act(async () => pending.resolve());
    expect(rows()[0].getAttribute("data-attention-status")).toBe("open");
    expect(rows()[0].querySelector<HTMLFieldSetElement>("fieldset")?.disabled).toBe(true);
  });

  it("shows storage evidence in a copyable popover without queue accordions", async () => {
    const input = syntheticAttention(), calls = callbacks();
    const copy = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    await act(async () => root.render(<AttentionQueueView input={input} callbacks={calls} open onClose={() => {}} />));
    expect(host.querySelector("details, summary")).toBeNull();
    expect(document.querySelector('[role="dialog"][aria-label="Storage evidence"]')).toBeNull();
    const evidence = button("Evidence");
    expect(evidence.getAttribute("aria-expanded")).toBe("false");
    await act(async () => evidence.click());
    const dialog = document.querySelector<HTMLElement>('[role="dialog"][aria-label="Storage evidence"]')!;
    expect(dialog).not.toBeNull();
    expect(host.contains(dialog)).toBe(false);
    expect(dialog.querySelector("details, summary")).toBeNull();
    const detail = input.sessions.find(session => session.id === "storage")!.codexStorageError!;
    expect(dialog.querySelector("pre")?.textContent).toBe(detail);
    expect(evidence.getAttribute("aria-expanded")).toBe("true");
    expect(evidence.getAttribute("aria-controls")).toBe(dialog.id);
    await act(async () => button("Copy details", dialog).click());
    expect(copy).toHaveBeenCalledExactlyOnceWith(detail);
    expect(dialog.textContent).toContain("Copied details");
    expect(calls.repair).not.toHaveBeenCalled();
  });

  it("restores focus to the evidence trigger after closing its popover", async () => {
    await act(async () => root.render(<AttentionQueueView input={inputFor("storage")} callbacks={callbacks()} open onClose={() => {}} />));
    const evidence = button("Evidence");
    evidence.focus();
    await act(async () => evidence.click());
    const dialog = document.querySelector<HTMLElement>('[role="dialog"][aria-label="Storage evidence"]')!;
    expect(document.activeElement).toBe(dialog);
    await act(async () => dialog.querySelector<HTMLButtonElement>('button[aria-label="Close evidence"]')!.click());
    expect(document.querySelector('[role="dialog"][aria-label="Storage evidence"]')).toBeNull();
    expect(document.activeElement).toBe(evidence);
    expect(evidence.getAttribute("aria-expanded")).toBe("false");
  });

  it("closes evidence on the first Escape and the queue on the next Escape", async () => {
    const close = vi.fn();
    await act(async () => root.render(<AttentionQueueView input={inputFor("storage")} callbacks={callbacks()} open onClose={close} />));
    const evidence = button("Evidence"); evidence.focus();
    await act(async () => evidence.click());
    const dialog = document.querySelector<HTMLElement>('[role="dialog"][aria-label="Storage evidence"]')!;
    const first = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    await act(async () => dialog.dispatchEvent(first));
    expect(first.defaultPrevented).toBe(true);
    expect(close).not.toHaveBeenCalled();
    expect(document.querySelector('[role="dialog"][aria-label="Storage evidence"]')).toBeNull();
    expect(document.activeElement).toBe(evidence);
    const second = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    await act(async () => evidence.dispatchEvent(second));
    expect(second.defaultPrevented).toBe(true);
    expect(close).toHaveBeenCalledOnce();
  });

  it("removes portalled evidence when its queue hides and reopens with evidence closed", async () => {
    const input = inputFor("storage"), calls = callbacks();
    const render = (open: boolean) => root.render(<AttentionQueueView input={input} callbacks={calls} open={open} onClose={() => {}} />);
    await act(async () => render(true));
    await act(async () => button("Evidence").click());
    expect(document.querySelector('[role="dialog"][aria-label="Storage evidence"]')).not.toBeNull();
    await act(async () => render(false));
    expect(host.querySelector<HTMLElement>(".attention-queue")?.hidden).toBe(true);
    expect(document.querySelector('[role="dialog"][aria-label="Storage evidence"]')).toBeNull();
    await act(async () => render(true));
    expect(button("Evidence").getAttribute("aria-expanded")).toBe("false");
    expect(document.querySelector('[role="dialog"][aria-label="Storage evidence"]')).toBeNull();
    expect(button("Use account version")).toBeDefined();
    expect(calls.repair).not.toHaveBeenCalled();
  });

  it("offers a compact panel header while retaining the same request and close callbacks", async () => {
    const close = vi.fn(), mission = vi.fn(), calls = callbacks();
    const props: AttentionQueueViewProps = { input: inputFor("manager"), callbacks: calls, open: true,
      onClose: close, onOpenMissionControl: mission, presentation: "panel" };
    await act(async () => root.render(<AttentionQueueView {...props} />));
    const queue = host.querySelector<HTMLElement>(".attention-queue")!;
    const toolbar = host.querySelector<HTMLElement>(".aq-toolbar")!;
    const title = toolbar.querySelector(".aq-title")!;
    expect(queue.dataset.presentation).toBe("panel");
    expect(title.tagName).toBe("H2");
    expect(title.textContent).toBe("Attention");
    expect(queue.getAttribute("aria-labelledby")).toBe(title.id);
    expect(toolbar.querySelector(".aq-eyebrow")).toBeNull();
    expect(toolbar.querySelector("p")).toBeNull();
    expect(buttons(toolbar).map(button => button.textContent)).toEqual(["Close"]);
    expect(host.querySelector("details, summary")).toBeNull();
    await act(async () => button("Allow once").click());
    expect(calls.approval).toHaveBeenCalledExactlyOnceWith("manager", 71, "allow");
    await act(async () => button("Close", toolbar).click());
    expect(close).toHaveBeenCalledOnce();
    expect(mission).not.toHaveBeenCalled();
  });

  it("retains page navigation to Mission control when requested", async () => {
    const mission = vi.fn();
    await act(async () => root.render(<AttentionQueueView input={inputFor("manager")} callbacks={callbacks()} open
      onClose={() => {}} onOpenMissionControl={mission} />));
    expect(host.querySelector<HTMLElement>(".attention-queue")?.dataset.presentation).toBe("page");
    expect(host.querySelector(".aq-toolbar .aq-title")?.tagName).toBe("H1");
    await act(async () => button("Back to goals").click());
    expect(mission).toHaveBeenCalledOnce();
  });

  it.each(["synchronous", "asynchronous"] as const)("keeps %s approval errors visible and enables a deliberate retry", async kind => {
    const calls = callbacks();
    calls.approval = vi.fn(kind === "synchronous" ? () => { throw Error("Permission reply failed"); }
      : async () => { throw Error("Permission reply failed"); });
    await act(async () => root.render(<AttentionQueueView input={inputFor("manager")} callbacks={calls} open onClose={() => {}} />));
    await act(async () => button("Allow once").click());
    expect(host.querySelector('[role="alert"]')?.textContent).toBe("Permission reply failed");
    expect(rows()[0].getAttribute("data-attention-status")).toBe("open");
    expect(button("Allow once").disabled).toBe(false);
    await act(async () => button("Deny").click());
    expect(calls.approval).toHaveBeenCalledTimes(2);
  });

  it("retains failed repair and delivery receipts with their saved source items", async () => {
    const calls = callbacks();
    calls.repair = vi.fn(async () => { throw Error("Recovery file changed"); });
    calls.retryDelivery = vi.fn(async () => { throw Error("Delivery still unavailable"); });
    await act(async () => root.render(<AttentionQueueView input={inputFor("storage", "delivery")} callbacks={calls} open onClose={() => {}} />));
    await act(async () => button("Keep MonoCode version").click());
    await act(async () => button("Retry delivery").click());
    expect(calls.repair).toHaveBeenCalledExactlyOnceWith("storage", "keep_mono_version");
    expect(calls.retryDelivery).toHaveBeenCalledExactlyOnceWith("delivery");
    const errors = [...host.querySelectorAll('[role="alert"]')].map(node => node.textContent);
    expect(errors).toContain("Recovery file changed");
    expect(errors).toContain("Delivery still unavailable");
    expect(rows()).toHaveLength(2);
    expect(button("Retry delivery").disabled).toBe(false);
  });

  it("rechecks fresh sources before executing an outdated rendered approval", async () => {
    const before = inputFor("manager"), calls = callbacks();
    const fresh = { ...before, sessions: [{ ...before.sessions[0], blocks: [] }] };
    await act(async () => root.render(<AttentionQueueView input={before} readInput={() => fresh} callbacks={calls} open onClose={() => {}} />));
    await act(async () => button("Allow once").click());
    expect(calls.approval).not.toHaveBeenCalled();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("changed or is no longer available");
  });

  it("waits for the source to clear a submitted answer before putting it in resolved history", async () => {
    let input = inputFor("decision");
    const calls = callbacks();
    const render = () => root.render(<AttentionQueueView input={input} callbacks={calls} open onClose={() => {}} />);
    await act(async () => render());
    await act(async () => button("Skip").click());
    expect(calls.question).toHaveBeenCalledExactlyOnceWith("decision", 81, { kind: "skipped" });
    expect(rows()[0].getAttribute("data-attention-status")).toBe("open");
    input = { ...input, sessions: [{ ...input.sessions[0], pendingQuestion: undefined }] };
    await act(async () => render());
    expect(rows()).toHaveLength(0);
    await act(async () => button("History").click());
    expect(rows()[0].getAttribute("data-attention-status")).toBe("resolved");
    expect(rows()[0].querySelector("button")).toBeNull();
  });

  it("promotes history to resolved when source acknowledgement precedes callback settlement", async () => {
    let input = inputFor("decision");
    const calls = callbacks(), pending = deferred();
    calls.question = vi.fn(() => pending.promise);
    const render = () => root.render(<AttentionQueueView input={input} callbacks={calls} open onClose={() => {}} />);
    await act(async () => render());
    await act(async () => button("Skip").click());
    input = { ...input, sessions: [{ ...input.sessions[0], pendingQuestion: undefined }] };
    await act(async () => render());
    await act(async () => button("History").click());
    expect(rows()[0].getAttribute("data-attention-status")).toBe("stale");
    await act(async () => pending.resolve());
    expect(rows()[0].getAttribute("data-attention-status")).toBe("resolved");
  });

  it("captures acknowledgement arriving in the submission microtask", async () => {
    let input = inputFor("decision");
    const calls = callbacks();
    const render = () => root.render(<AttentionQueueView input={input} callbacks={calls} open onClose={() => {}} />);
    calls.question = vi.fn(async () => {
      input = { ...input, sessions: [{ ...input.sessions[0], pendingQuestion: undefined }] };
      render();
      await Promise.resolve();
    });
    await act(async () => render());
    await act(async () => button("Skip").click());
    await act(async () => button("History").click());
    expect(rows()).toHaveLength(1);
    expect(rows()[0].getAttribute("data-attention-status")).toBe("resolved");
  });

  it("keeps a failed inspection receipt without losing a submitted answer's resolved history", async () => {
    let input = inputFor("decision");
    const calls = callbacks();
    calls.inspect = vi.fn(async () => { throw Error("Conversation navigation failed"); });
    const render = () => root.render(<AttentionQueueView input={input} callbacks={calls} open onClose={() => {}} />);
    await act(async () => render());
    await act(async () => button("Skip").click());
    expect(calls.question).toHaveBeenCalledExactlyOnceWith("decision", 81, { kind: "skipped" });
    await act(async () => button("Open conversation").click());
    expect(host.querySelector('[role="alert"]')?.textContent).toBe("Conversation navigation failed");
    expect(rows()[0].querySelector<HTMLFieldSetElement>("fieldset")?.disabled).toBe(true);
    input = { ...input, sessions: [{ ...input.sessions[0], pendingQuestion: undefined }] };
    await act(async () => render());
    await act(async () => button("History").click());
    expect(rows()[0].getAttribute("data-attention-status")).toBe("resolved");
    expect(rows()[0].querySelector('[role="alert"]')?.textContent).toBe("Conversation navigation failed");
    expect(rows()[0].querySelector("button")).toBeNull();
    expect(calls.question).toHaveBeenCalledOnce();
  });

  it("unlocks a revised storage request sharing the same identity and keeps its prior revision in history", async () => {
    let input = inputFor("storage");
    const calls = callbacks();
    const render = () => root.render(<AttentionQueueView input={input} callbacks={calls} open onClose={() => {}} />);
    await act(async () => render());
    await act(async () => button("Use account version").click());
    expect(rows()[0].querySelector<HTMLFieldSetElement>("fieldset")?.disabled).toBe(true);
    input = { ...input, sessions: [{ ...input.sessions[0], codexStorageError: "New synthetic storage failure" }] };
    await act(async () => render());
    expect(rows()[0].querySelector<HTMLFieldSetElement>("fieldset")?.disabled).toBe(false);
    expect(button("Repair").disabled).toBe(false);
    expect(rows()[0].querySelector(".aq-receipt")).toBeNull();
    await act(async () => button("Repair").click());
    expect(calls.repair).toHaveBeenCalledTimes(2);
    await act(async () => button("History").click());
    expect(rows()).toHaveLength(1);
    expect(rows()[0].getAttribute("data-attention-status")).toBe("replaced");
    expect(rows()[0].getAttribute("aria-label")).toBe("Codex storage needs repair");
    expect(rows()[0].querySelector("button")).toBeNull();
  });

  it("moves unacknowledged missing requests to stale history without pretending they succeeded", async () => {
    const input = inputFor("manager"), calls = callbacks();
    await act(async () => root.render(<AttentionQueueView input={input} callbacks={calls} open onClose={() => {}} />));
    await act(async () => root.render(<AttentionQueueView input={{ ...input, sessions: [] }} callbacks={calls} open onClose={() => {}} />));
    await act(async () => button("History").click());
    expect(rows()[0].getAttribute("data-attention-status")).toBe("stale");
    expect(rows()[0].querySelector("button")).toBeNull();
    expect(calls.approval).not.toHaveBeenCalled();
  });

  it("uses real usage recovery and retains the blocker until the source clears", async () => {
    const calls = callbacks();
    await act(async () => root.render(<AttentionQueueView input={inputFor("usage")} callbacks={calls} open onClose={() => {}} />));
    await act(async () => button("Resume").click());
    expect(calls.resume).toHaveBeenCalledExactlyOnceWith("usage");
    expect(rows()[0].getAttribute("data-attention-status")).toBe("open");
    expect(rows()[0].querySelector<HTMLFieldSetElement>("fieldset")?.disabled).toBe(true);
  });

  it("preserves the filter and scroll on hide, respects consumed Escape, and closes on keyboard Escape", async () => {
    const input = syntheticAttention(), calls = callbacks(), close = vi.fn();
    const render = (open: boolean) => root.render(<AttentionQueueView input={input} callbacks={calls} open={open} onClose={close} />);
    await act(async () => render(true));
    await act(async () => button("Failures").click());
    const scroll = host.querySelector<HTMLElement>(".aq-scroll")!; scroll.scrollTop = 240;
    const consumed = new KeyboardEvent("keydown", { key: "Escape", cancelable: true, bubbles: true }); consumed.preventDefault();
    await act(async () => document.body.dispatchEvent(consumed));
    expect(close).not.toHaveBeenCalled();
    const escape = new KeyboardEvent("keydown", { key: "Escape", cancelable: true, bubbles: true });
    await act(async () => document.body.dispatchEvent(escape));
    expect(escape.defaultPrevented).toBe(true);
    expect(close).toHaveBeenCalledOnce();
    await act(async () => render(false));
    expect(host.querySelector<HTMLElement>(".attention-queue")?.hidden).toBe(true);
    expect(host.querySelector<HTMLElement>(".attention-queue")?.inert).toBe(true);
    const hidden = new KeyboardEvent("keydown", { key: "Escape", cancelable: true, bubbles: true });
    await act(async () => document.body.dispatchEvent(hidden));
    expect(hidden.defaultPrevented).toBe(false);
    expect(close).toHaveBeenCalledOnce();
    await act(async () => render(true));
    expect(button("Failures").getAttribute("aria-pressed")).toBe("true");
    expect(scroll.scrollTop).toBe(240);
    await act(async () => button("Back to conversation").click());
    expect(close).toHaveBeenCalledTimes(2);
  });

  it.each([false, true])("provides a keyboard-named shell entry with compact=%s", async compact => {
    const open = vi.fn();
    await act(async () => root.render(<AttentionQueueNav compact={compact} onOpen={open} />));
    const nav = host.querySelector<HTMLButtonElement>('button[aria-label="Attention queue"]')!;
    expect(nav.title).toBe("Attention queue");
    await act(async () => nav.click());
    expect(open).toHaveBeenCalledOnce();
  });

  it("opens the queue from the Mission control banner without opening a conversation", async () => {
    const open = vi.fn(() => <p>Hosted attention queue</p>), target = vi.fn();
    const view = selectGoalViews({ goals, roster, runs, sessions, now });
    await act(async () => root.render(<MissionControlView view={view} attentionInput={{ goals, roster, runs, sessions }} onOpenTarget={target} onClose={() => {}} renderAttention={open} />));
    await act(async () => button("View all", host.querySelector(".mc-attention")!).click());
    expect(open).toHaveBeenCalled();
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Hosted attention queue");
    expect(target).not.toHaveBeenCalled();
  });

  it("shows source refresh failures beside the current queue", async () => {
    await act(async () => root.render(<AttentionQueueView input={inputFor("manager")} callbacks={callbacks()} open onClose={() => {}}
      sourceError="Could not refresh automation failures: synthetic network failure" />));
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("synthetic network failure");
    expect(rows()).toHaveLength(1);
    expect(button("Allow once").disabled).toBe(false);
  });

  it("keeps panel rows terse and exposes exact request evidence in the existing popover", async () => {
    await act(async () => root.render(<AttentionQueueView input={inputFor("manager")} callbacks={callbacks()} open onClose={() => {}} presentation="panel" />));
    expect(host.querySelector(".aq-item .aq-path")?.textContent).toContain("User-owned request");
    expect(host.querySelector(".aq-item .aq-owner")).toBeNull();
    expect(host.querySelector(".aq-item .aq-evidence")).toBeNull();
    await act(async () => button("Evidence").click());
    const evidence = document.querySelector('[role="dialog"]')!;
    expect(evidence.textContent).toContain("Request 71");
    expect(evidence.textContent).toContain("Conversation manager");
    expect(evidence.textContent).toContain("Run the local release verification command");
    expect(button("Allow once").disabled).toBe(false);
  });
});
