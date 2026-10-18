// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { MonoTeamActivity } from "./MonoTeamActivity";
import { MemberWorkLog } from "./MemberWorkLog";
import { MemberDetails, MonoTeamPage } from "./MonoTeamPage";
import { MonoHeader } from "./MonoHeader";
import { MonoOrgActivity } from "./MonoOrgActivity";
import { MonoRailSection } from "../../../app/shell/MonoRailSection";
import { TitleBar } from "../../../app/shell/TitleBar";
import { ProjectManagerRow } from "../../orchestration/ui/ProjectManagerRow";
import { orchestrator } from "../../orchestration/model/orchestration";
import { managerWorktreeStatus } from "../../orchestration/model/projectManager";
import { monoLiveState } from "../model/monoNavigation";
import { monoLook, MONO_STATUS_LABEL, type Mono } from "../model/mono";
import { newSession, type Session } from "../../sessions/model/session";
import type { OrchestrationRun, OrchestrationTask } from "../../orchestration/model/orchestrationState";
import { publishCardSessions } from "../model/monoCards";

vi.mock("../model/monoFiles", async original => ({ ...(await original<object>()), loadMonoFiles: vi.fn(async () => ({ soul: "", memory: "", topics: [] })) }));
vi.mock("../../source-control/hooks/useProjectWorktrees", () => ({ useProjectWorktrees: () => ({ data: { worktrees: [{}] } }) }));
const noop = () => {};
const roster: Mono[] = [
  { id: "o", role: "orchestrator", name: "GRAND ORCH", sessionId: "orch-chat", projects: ["/app"], mascot: "cat", color: "#abc" },
  { id: "m", role: "manager", name: "App Manager", sessionId: "manager-chat", reportsTo: "o", managerProject: "/app", projects: ["/app"], mascot: "cat", color: "#abc" },
  { id: "b", role: "member", name: "Backend", reportsTo: "m", projects: ["/app"], specialty: "Backend", mascot: "cat", color: "#abc" },
];

it("uses the reviewed lifecycle on cards, Activity, recent tasks, org task rows, worktrees and crew feed", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.setItem("monocode:mono-roster", JSON.stringify(roster));
  const task = { id: "t", memberId: "b", sessionId: "worker", title: "Inspect routing", prompt: "Inspect the routes", status: "completed", lastDispatchId: "d", workspace: { checkoutCwd: "/worker", branch: "worker" } } as OrchestrationTask;
  const runs = [{ leadId: "engine", ownerMonoId: "m", projectManager: true, cwd: "/app", tasks: [task], dispatches: [{ id: "d", taskId: "t", state: "completed", startedAt: 1, updatedAt: 2 }] }] as OrchestrationRun[];
  const snapshot = vi.spyOn(orchestrator, "snapshot").mockReturnValue(runs);
  const host = document.createElement("div"), root = createRoot(host);
  let sessions: Session[] = [];
  const render = () => act(async () => root.render(<>
    <MemberWorkLog member={roster[2]} />
    <MemberDetails member={roster[2]} fallback={{ harness: "codex", model: "codex:gpt-5.4" }} onBack={noop} />
    <MonoTeamActivity monoId="o" sessions={sessions} runs={runs} statuses={new Map()} onApproval={noop} onQuestion={noop} onQuestionInteraction={noop} />
  </>));
  try {
    for (const [changes, label] of [
      [{}, "In review"],
      [{ reviewVerdict: { dispatchId: "d", decision: "changes" } }, "Changes requested"],
      [{ reviewVerdict: undefined, accepted: true, acceptedDispatchId: "d", completionOutcome: "no-changes-baseline-unknown" }, "Completed (no changes, baseline unknown)"],
    ] as const) {
      Object.assign(task, changes);
      await render();
      expect(host.querySelector("[data-task-status]")?.textContent).toBe(label);
      expect(host.querySelector('[aria-label="Member tasks"]')?.textContent).toContain(label);
      expect(host.querySelector('[data-team-task="t"]')?.textContent).toContain(label);
      expect(host.querySelector('[data-org-member="b"]')?.textContent).toContain(label);
      expect(host.querySelector("[data-crew-feed]")?.textContent).toContain(label);
      expect(managerWorktreeStatus(runs, "/worker")).toBe(label.startsWith("Completed") ? undefined : label);
    }
    Object.assign(task, { accepted: false, completionOutcome: undefined, status: "running" });
    const worker = { ...newSession("codex", "/app"), id: "worker", busy: true };
    for (const session of [
      { ...worker, pendingQuestion: { requestId: 1, title: "Choose", questions: [] } },
      { ...worker, blocks: [{ id: "approval", role: "tool" as const, text: "", approval: { requestId: 1 } }] },
    ]) {
      sessions = [session];
      await act(async () => publishCardSessions([{ id: "worker", title: "", harness: "codex", busy: true, needsInput: true }], noop));
      await render();
      expect(host.querySelector("[data-task-status]")?.textContent).toBe("Needs you");
      expect(host.querySelector('[aria-label="Member tasks"]')?.textContent).toContain("Needs you");
      expect(host.querySelector('[data-team-task="t"]')?.textContent).toContain("Needs you");
      expect(host.querySelector('[data-org-member="b"]')?.textContent).toContain("Needs you");
      expect(host.querySelector("[data-crew-feed]")?.textContent).toContain("Needs you");
      expect(managerWorktreeStatus(runs, "/worker", new Set(["worker"]))).toBe("Needs you");
    }
  } finally {
    await act(async () => root.unmount()); publishCardSessions([], noop); snapshot.mockRestore(); localStorage.clear(); vi.unstubAllGlobals();
  }
});

it("keeps sidebar, title, centered header and org nodes consistent on start, attention and finish", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.setItem("monocode:mono-roster", JSON.stringify(roster));
  const host = document.createElement("div"), root = createRoot(host);
  const session = { ...newSession("codex", "/app"), id: "manager-chat", busy: false };
  const sessions = [session];
  const render = () => {
    const state = monoLiveState(roster, [], sessions, "o");
    const states = new Map(roster.map(mono => [mono.id, monoLiveState(roster, [], sessions, mono.id)]));
    return act(async () => root.render(<>
      <MonoRailSection states={states} onCreate={noop} onOpen={noop} onDelete={noop} />
      <TitleBar tabs={[]} activeId="" cwd="/app" mono={{ look: monoLook(roster[0]), state }} onToggleSidebar={noop} onSelect={noop} onClose={noop} onCloseMany={noop} onReorder={noop} hideWindowControls />
      <MonoHeader agent={monoLook(roster[0])} state={state} />
      <MonoOrgActivity rootId="o" roster={roster} runs={[]} sessions={sessions} now={1} />
      <ProjectManagerRow project="/app" sessions={sessions} onOpen={async () => {}} />
    </>));
  };
  try {
    for (const status of ["idle", "working", "needs-you", "idle"] as const) {
      session.busy = status === "working";
      session.pendingQuestion = status === "needs-you" ? { requestId: 1, title: "Choose", questions: [] } : undefined;
      await render();
      const ownStatus = status === "working" ? "idle" : status;
      const label = MONO_STATUS_LABEL[ownStatus] + (status === "needs-you" ? " · in app" : "");
      expect(host.querySelector("[data-mono-title]")?.textContent).toContain(label);
      expect(host.querySelector("header")?.textContent).toContain(label);
      expect(host.querySelector('[data-org-member="o"]')?.firstElementChild?.textContent).toContain(label);
      expect(host.querySelector('[aria-label="Open project manager"]')?.textContent).toContain(MONO_STATUS_LABEL[status]);
      expect(host.querySelector(`[aria-label="GRAND ORCH, ${label}${status === "working" ? ", 1 working below" : ""}"]`)).not.toBeNull();
      if (status === "working") {
        expect(host.querySelector("[data-mono-title]")?.textContent).toContain("1 working below");
        expect(host.querySelector("header")?.textContent).toContain("1 working below");
        expect(host.querySelector('[data-org-member="o"]')?.firstElementChild?.textContent).toContain("1 working below");
        expect(host.querySelector('[data-mono-rail] [data-mono-status="working"]')).toBeNull();
      }
    }
  } finally { await act(async () => root.unmount()); localStorage.clear(); vi.unstubAllGlobals(); }
});

it("opens a newly assigned Manager before its session starts", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.setItem("monocode:mono-roster", JSON.stringify([roster[0], { ...roster[1], sessionId: undefined }]));
  const host = document.createElement("div"), root = createRoot(host), open = vi.fn();
  window.addEventListener("monocode:open-team", open);
  try {
    await act(async () => root.render(<MonoTeamPage monoId="o" fallback={{ harness: "codex", model: "codex:gpt-5.4" }} onBack={noop} />));
    await act(async () => [...host.querySelectorAll("button")].find(button => button.textContent?.includes("App Manager"))!.click());
    expect(open.mock.calls[0][0].detail).toEqual({ monoId: "m" });
  } finally { window.removeEventListener("monocode:open-team", open); await act(async () => root.unmount()); localStorage.clear(); vi.unstubAllGlobals(); }
});

it("keeps Permissions before Specialty when member details are opened from Team", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.setItem("monocode:mono-roster", JSON.stringify(roster));
  const host = document.createElement("div"), root = createRoot(host);
  try {
    await act(async () => root.render(<MonoTeamPage monoId="m" fallback={{ harness: "codex", model: "codex:gpt-5.4" }} onBack={noop} />));
    await act(async () => [...host.querySelectorAll("button")].find(button => button.textContent?.includes("Backend"))!.click());
    expect([...host.querySelectorAll("dt")].map(row => row.textContent)).toEqual(["Model", "Permissions", "Specialty"]);
    expect(host.querySelector("dl")?.textContent).toContain("Full access");
    expect(host.querySelector("[data-access-picker-trigger]")).toBeNull();
    await act(async () => root.render(<MemberDetails member={{ ...roster[2], sessionId: "member-chat" }} fallback={{ harness: "codex", model: "codex:gpt-5.4" }} onBack={noop} />));
    expect(host.querySelector("dl")?.textContent).toContain("Open chat to view");
    await act(async () => publishCardSessions([{ id: "member-chat", title: "", harness: "codex", busy: false, needsInput: false, runtimeMode: "supervised" }], noop));
    expect(host.querySelector("dl")?.textContent).toContain("Supervised");
  } finally { await act(async () => root.unmount()); localStorage.clear(); vi.unstubAllGlobals(); }
});
