// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { MonoDecision } from "../../monos/model/monoDecisions";
import type { Mono } from "../../monos/model/mono";
import type { DecisionView } from "../model/decisionView";
import { Decisions, type DecisionUiActions } from "./Decisions";

let host: HTMLDivElement, root: ReturnType<typeof createRoot>;
const roster: Mono[] = [{ id: "worker", name: "Builder", role: "member", projects: ["/project"], mascot: "w", color: "blue" },
  { id: "manager", name: "Manager", role: "manager", projects: ["/project"], mascot: "m", color: "blue" },
  { id: "boss", name: "Boss", role: "orchestrator", projects: [], mascot: "b", color: "blue" }];
const empty = (): DecisionView => ({ pending: [], log: [], teamPending: 0, handledToday: 0, pruned: 0, loading: [], quarantine: [] });
const decision = (): MonoDecision => ({ id: "worker-session:question", projectId: "/project", question: "<img src=x onerror=alert(1)> Which option?", impact: "med", context: "<script>untrusted</script>",
  options: [{ id: "reuse", label: "Reuse" }, { id: "change", label: "Change" }], recommendedOptionId: "reuse", recommenderId: "worker", operation: "work", status: "pending", deciderLevel: "user", currentLevel: 3,
  resolutionVersion: 2, deliveryState: "current", createdAt: 1, updatedAt: 1, history: [], escalationChain: [{ id: "worker", level: "worker" }, { id: "manager", level: "manager" }, { id: "boss", level: "boss" }, { id: "user", level: "user" }] } as unknown as MonoDecision);
const actions = (): DecisionUiActions => ({ command: vi.fn(async () => {}), reraise: vi.fn(async () => {}), openProject: vi.fn() });
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
const button = (name: string) => [...host.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent?.includes(name))!;

it("renders honest empty/unavailable/loading state and no invented prototype totals", async () => {
  await act(async () => root.render(<Decisions view={empty()} roster={roster} actions={actions()} />));
  expect(host.textContent).toContain("Nothing needs your decision");
  expect(host.textContent).not.toContain("14 decisions");
  await act(async () => root.render(<Decisions view={{ ...empty(), loading: ["manager"] }} roster={roster} actions={actions()} unavailable />));
  expect(host.textContent).toContain("unavailable");
  expect(host.textContent).toContain("Loading decision history");
  expect(host.textContent).not.toContain("Nothing needs your decision");
});

it("renders untrusted text, real recommendation attribution and versioned direct-event actions", async () => {
  const source = decision(), handlers = actions();
  let release!: () => void;
  vi.mocked(handlers.command).mockImplementationOnce(() => new Promise(resolve => { release = () => resolve(undefined); }));
  await act(async () => root.render(<Decisions view={{ ...empty(), pending: [{ managerId: "manager", decision: source }] }} roster={roster} actions={handlers} />));
  expect(host.querySelector("script, img")).toBeNull();
  expect(host.textContent).toContain("Builder recommends");
  expect(host.textContent).not.toContain("Boss recommends");
  const choose = button("Reuse"); choose.focus(); expect(document.activeElement).toBe(choose);
  await act(async () => { choose.click(); choose.click(); });
  expect(handlers.command).toHaveBeenCalledTimes(1);
  expect(handlers.command).toHaveBeenCalledWith(expect.any(Event), "manager", expect.stringMatching(/^decision-/), { action: "resolve", decisionId: source.id, expectedVersion: 2, optionId: "reuse" });
  expect(button("Let the Boss decide").disabled).toBe(true);
  await act(async () => release());
  await act(async () => button("Open project").click());
  expect(handlers.openProject).toHaveBeenCalledWith("/project");
});

it("keeps protected-operation delegation absent and shows the actual resolved log", async () => {
  const source = { ...decision(), operation: "merge" as const, status: "decided" as const, selectedOptionId: "reuse", decidedAt: 1000, decidedBy: "user" };
  await act(async () => root.render(<Decisions view={{ ...empty(), log: [{ managerId: "manager", decision: source }] }} roster={roster} actions={actions()} />));
  await act(async () => button("Decision log").click());
  expect(host.textContent).toContain("your call");
  expect(host.textContent).toContain("Reuse");
  expect(button("Let the Boss decide")).toBeUndefined();
});

it("shows bounded read-only quarantine evidence and sends only a re-raise request", async () => {
  const handlers = actions();
  const entry = { at: 1, reason: "unreadable-decision-history" as const, raw: JSON.stringify({ decisions: [{ id: "old-id", status: "pending", question: "Old question" }] }) };
  await act(async () => root.render(<Decisions view={{ ...empty(), quarantine: [{ managerId: "manager", entries: [entry] }] }} roster={roster} actions={handlers} />));
  await act(async () => button("View").click());
  expect(host.querySelector("pre")?.textContent).toBe(entry.raw);
  await act(async () => button("Ask the Manager to re-raise").click());
  expect(handlers.reraise).toHaveBeenCalledWith(expect.any(Event), "manager", expect.stringMatching(/^decision-/), "old-id");
  expect(handlers.command).not.toHaveBeenCalled();
});
