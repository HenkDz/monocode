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
import { MonoChatCard } from "./MonoChatCard";
import { monoManagerGoals } from "../model/monoManagerGoals";
import { OrchestrationSidebarAgents } from "../../orchestration/ui/OrchestrationSidebarAgents";
import { summarizeOrchestration } from "../../orchestration/model/orchestrationSummary";
import { SearchableProjectPicker } from "../../projects/ui/SearchableProjectPicker";
import { selectAgentLiveState } from "../../agents/model/agentLiveState";

vi.mock("../model/monoFiles", async original => ({ ...(await original<object>()), loadMonoFiles: vi.fn(async () => ({ soul: "", memory: "", topics: [] })) }));
vi.mock("../../source-control/hooks/useProjectWorktrees", () => ({ useProjectWorktrees: () => ({ data: { worktrees: [{}] } }) }));
const noop = () => {};
const roster: Mono[] = [
  { id: "o", role: "orchestrator", name: "GRAND ORCH", sessionId: "orch-chat", projects: ["/app"], mascot: "cat", color: "#abc" },
  { id: "m", role: "manager", name: "App Manager", sessionId: "manager-chat", reportsTo: "o", managerProject: "/app", projects: ["/app"], mascot: "cat", color: "#abc" },
  { id: "b", role: "member", name: "Backend", reportsTo: "m", projects: ["/app"], specialty: "Backend", mascot: "cat", color: "#abc" },
];

it("keeps a queued Reviewer's storage blocker canonical on sidebar, project row, card, member header and compact picker", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const reviewer = { ...roster[2], name: "Reviewer", sessionId: "reviewer-chat" };
  const members = [...roster.slice(0, 2), reviewer];
  localStorage.setItem("monocode:mono-roster", JSON.stringify(members));
  const session = { ...newSession("codex", "/app"), id: reviewer.sessionId, codexStorageError: "Repair AGENTS.md before the queued review", queuedMessages: [{ id: "q", text: "Review the changes", attachments: [] }] };
  const task = { id: "review", title: "Reviewer", memberId: reviewer.id, memberName: "Reviewer", sessionId: session.id, harness: "codex", model: "codex:gpt-5.4", status: "queued" } as OrchestrationTask;
  const run = { leadId: "engine", ownerMonoId: "m", cwd: "/app", projectManager: true, status: "paused", tasks: [task], dispatches: [] } as unknown as OrchestrationRun;
  const runs = [run], sessions = [session];
  const snapshot = vi.spyOn(orchestrator, "snapshot").mockReturnValue(runs);
  const hydrate = vi.spyOn(monoManagerGoals, "hydrate").mockResolvedValue({ version: 1, goals: [], receipts: {} });
  const metrics = { turns: 1, elapsedMs: 1000, inputTokens: 100, cacheReadTokens: 80, outputTokens: 10, modelCalls: 2, compactions: 1, partial: true };
  publishCardSessions([{ id: session.id, title: "Reviewer", harness: "codex", busy: false, needsInput: false, liveState: selectAgentLiveState(session), taskMetrics: { review: metrics } }], noop);
  const state = monoLiveState(members, runs, sessions, reviewer.id);
  const look = monoLook(reviewer);
  const host = document.createElement("div"), root = createRoot(host);
  document.body.append(host);
  try {
    await act(async () => root.render(<>
      <section data-surface="sidebar"><OrchestrationSidebarAgents leadId={run.leadId} summary={summarizeOrchestration(run, sessions)} /></section>
      <section data-surface="project"><ProjectManagerRow project="/app" sessions={sessions} onOpen={async () => {}} /></section>
      <section data-surface="card"><MonoChatCard monoId={reviewer.id} blockId="session-card" card={{ type: "session", sessionId: session.id }} /></section>
      <section data-surface="header"><MonoHeader agent={look} state={state} /></section>
      <section data-surface="picker"><SearchableProjectPicker cwd="/app" recents={[]} compact onSelectProject={noop} monos={{ activeId: reviewer.id, items: [{ id: reviewer.id, name: look.name, mascot: look.mascot, color: look.color, status: state.status, state }], onOpen: noop }} /></section>
    </>));
    const rows = [
      host.querySelector('[data-surface="sidebar"] [aria-label="Agent details: Reviewer"]')!,
      host.querySelector('[data-surface="project"] [aria-label="Open Reviewer"]')!,
      host.querySelector('[data-surface="card"] button')!,
      host.querySelector('[data-surface="header"] [data-mono-status]')!,
      host.querySelector('[data-surface="picker"] button')!,
    ];
    for (const row of rows) {
      const label = `${row.textContent ?? ""} ${row.getAttribute("aria-label") ?? ""}`;
      expect(label).toContain("Blocked · storage");
      expect(label).not.toContain("Idle");
    }
    for (const row of rows.filter((element): element is HTMLButtonElement => element instanceof HTMLButtonElement)) {
      const id = row.getAttribute("aria-describedby")!;
      expect(document.getElementById(id)?.textContent).toContain("Blocked · storage");
      expect(document.getElementById(id)?.textContent).toContain(session.codexStorageError);
      await act(async () => row.focus());
      expect(document.getElementById(id)?.getAttribute("role")).toBe("tooltip");
      expect(row.querySelector("button, [tabindex]")).toBeNull();
    }
    expect(rows[0].getAttribute("aria-describedby")).not.toBeNull();
    await act(async () => (rows[0] as HTMLButtonElement).focus());
    expect(document.getElementById(rows[0].getAttribute("aria-describedby")!)?.textContent).toContain("Model calls 2 · Compactions 1");
  } finally {
    await act(async () => root.unmount()); host.remove(); publishCardSessions([], noop); snapshot.mockRestore(); hydrate.mockRestore(); localStorage.clear(); vi.unstubAllGlobals();
  }
});

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
      if (label.startsWith("Completed")) await act(async () => host.querySelector<HTMLButtonElement>('button[aria-controls$="-history"]')!.click());
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
      expect(host.querySelector('[aria-label="Open project manager"]')?.textContent).toContain(status === "working" ? "Thinking" : MONO_STATUS_LABEL[status]);
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
