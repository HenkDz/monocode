import { useState } from "react";
import { createRoot } from "react-dom/client";
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { MissionControlView } from "../../src/features/commandCenter/ui/MissionControl";
import { MissionCommandBar } from "../../src/features/commandCenter/ui/MissionCommandBar";
import { AttentionQueueView } from "../../src/features/commandCenter/ui/AttentionQueue";
import { selectCockpit } from "../../src/features/commandCenter/model/cockpit";
import { recordPullRequest } from "../../src/features/source-control/model/pullRequests";
import { selectGoalViews, type GoalTarget } from "../../src/features/commandCenter/model/goalView";
import { selectGoalTimeline } from "../../src/features/commandCenter/model/timeline";
import type { MonoGoalSubmission } from "../../src/features/monos/model/monoGoalRouting";
import type { Mono } from "../../src/features/monos/model/mono";
import type { MonoManagerGoal } from "../../src/features/monos/model/monoManagerGoals";
import type { Block, Session } from "../../src/features/sessions/model/session";
import type { OrchestrationRun, OrchestrationTask } from "../../src/features/orchestration/model/orchestrationState";
import { orchestrator } from "../../src/features/orchestration/model/orchestration";
import { ProjectManagerRow } from "../../src/features/orchestration/ui/ProjectManagerRow";
import { ProjectWorktrees } from "../../src/features/source-control/ui/ProjectWorktrees";
import { prStatusKey } from "../../src/features/source-control/hooks/usePrStatus";
import type { GitPr } from "../../src/platform/tauri/fs";
import "../../src/styles/index.css";

const params = new URLSearchParams(location.search);
document.documentElement.classList.toggle("theme-light", params.get("theme") === "light");
const now = Date.now();
const monoProject = "C:/synthetic/MonoCode";
const dzProject = "C:/synthetic/DZDistro";
const roster: Mono[] = [
  { id: "grand", role: "orchestrator", name: "Grand Orch", mascot: "owl", color: "#7dd3fc", projects: [monoProject, dzProject], sessionId: "grand-chat" },
  { id: "mono-manager", role: "manager", name: "Manager", reportsTo: "grand", managerProject: monoProject, managerEngineId: "mono-engine", mascot: "fox", color: "#7dd3fc", projects: [monoProject], sessionId: "mono-manager-chat" },
  { id: "builder", role: "member", name: "Builder", reportsTo: "mono-manager", specialty: "Engineering", mascot: "bear", color: "#6ee7b7", projects: [monoProject], sessionId: "builder-chat" },
  { id: "reviewer", role: "member", name: "Reviewer", reportsTo: "mono-manager", reviewer: true, mascot: "cat", color: "#fcd34d", projects: [monoProject], sessionId: "reviewer-chat" },
  { id: "designer", role: "member", name: "Designer", reportsTo: "mono-manager", specialty: "Product design", mascot: "rabbit", color: "#bbb", projects: [monoProject], sessionId: "designer-chat" },
  { id: "dz-manager", role: "manager", name: "Manager", reportsTo: "grand", managerProject: dzProject, managerEngineId: "dz-engine", mascot: "fox", color: "#7dd3fc", projects: [dzProject], sessionId: "dz-manager-chat" },
  { id: "backend", role: "member", name: "Backend", reportsTo: "dz-manager", specialty: "Engineering", mascot: "bear", color: "#7dd3fc", projects: [dzProject], sessionId: "backend-chat" },
  { id: "qa", role: "member", name: "QA", reportsTo: "dz-manager", specialty: "Verification", mascot: "cat", color: "#bbb", projects: [dzProject], sessionId: "qa-chat" },
];
localStorage.setItem("monocode:mono-roster", JSON.stringify(roster));
const turn = (id: string, seconds: number, durationMs?: number, extra: Partial<Block> = {}): Block => ({
  id, role: "user", text: "Synthetic fixture turn", startedAt: now - seconds * 1000, durationMs, ...extra,
});
const session = (id: string, cwd: string, blocks: Block[] = [], extra: Partial<Session> = {}): Session => ({
  id, harness: "codex", model: "synthetic", modelSettings: {}, runtimeMode: "supervised", title: id, cwd, blocks, ...extra,
});
const sessions = [
  session("grand-chat", monoProject, [turn("origin-mc", 1440, 15_000), turn("origin-calendar", 1080, 12_000), turn("origin-pricing", 3600, 10_000)]),
  session("mono-manager-chat", monoProject, [turn("mono-manager-turn", 102, 12_000)]),
  session("builder-chat", monoProject, [turn("builder-turn", 392, undefined, { turnMetrics: { compactions: [{ id: "compaction", startedAt: now - 370_000, endedAt: now - 347_000 }] } }),
    { id: "builder-tool", role: "tool", text: "Checking keyboard navigation", tool: { title: "Checking keyboard navigation", status: "running" } }], { busy: true, orchestrationLeadId: "mono-engine" }),
  session("reviewer-chat", monoProject, [], { orchestrationLeadId: "mono-engine", codexStorageAccountId: "synthetic-account", codexStorageError: "Synthetic storage conflict. Both instruction files and the queued review are retained.", queuedMessages: [{ id: "review-queue", text: "Review mission control", attachments: [] }] }),
  session("designer-chat", monoProject),
  session("dz-manager-chat", dzProject, [turn("dz-manager-turn", 130, 10_000), { id: "approval", role: "approval", text: "Run the synthetic staging smoke check.", startedAt: now - 120_000, tool: { title: "Staging smoke check", status: "waiting" }, approval: { requestId: 71 } }]),
  session("backend-chat", dzProject, [turn("backend-turn", 258)], { busy: true, orchestrationLeadId: "dz-engine" }),
  session("qa-chat", dzProject),
  session("pricing-chat", dzProject, [turn("pricing-turn", 1400, 680_000)]),
];
const goal = (id: string, title: string, project: string, engine: string, state: MonoManagerGoal["state"], seconds: number): MonoManagerGoal => ({
  id, title, monoId: "grand", projectId: project, managerId: engine, state, userMessageId: `origin-${id}`, requestId: `request-${id}`, prUrls: [], createdAt: now - seconds * 1000, updatedAt: now - 60_000,
});
const goals = [goal("mc", "Make mission control useful at a glance", monoProject, "mono-engine", "blocked", 1440),
  goal("calendar", "Keep calendar dates consistent across tenants", dzProject, "dz-engine", "running", 1080),
  goal("pricing", "Correct Arabic pricing labels", dzProject, "dz-engine", "done", 3600)];
const task = (id: string, goalId: string, memberId: string, title: string, status: OrchestrationTask["status"], extra: Partial<OrchestrationTask> = {}): OrchestrationTask => ({
  id, monoGoalId: goalId, memberId, memberName: roster.find(member => member.id === memberId)?.name, sessionId: `${memberId}-chat`, title, prompt: "Synthetic fixture only", harness: "codex", model: "synthetic", files: [], scopes: [], dependsOn: [], status, accepted: status === "completed", result: "", delivered: status === "completed", activeDispatchId: `dispatch-${id}`, ...extra,
});
const builder = task("build", "mc", "builder", "Checking keyboard navigation", "running", { managerTurnBlockId: "mono-manager-turn" });
const reviewer = task("review", "mc", "reviewer", "Review queued · storage conflict", "queued", { managerTurnBlockId: "mono-manager-turn", reviewOf: { taskId: "build", dispatchId: "dispatch-build" } });
const backend = task("calendar-work", "calendar", "backend", "Tracing tenant calendar boundaries", "running", { managerTurnBlockId: "dz-manager-turn" });
const pricing = task("pricing-work", "pricing", "pricing-worker", "Arabic pricing labels merged", "completed", { memberName: "Pricing worker", sessionId: "pricing-chat", prUrl: "https://github.com/synthetic/dzdistro/pull/1861", workspace: { id: "pricing-workspace", projectCwd: dzProject, checkoutCwd: dzProject, kind: "main" } });
const run = (leadId: string, ownerMonoId: string, project: string, tasks: OrchestrationTask[]): OrchestrationRun => ({
  version: 2, leadId, ownerMonoId, ownerSessionId: `${ownerMonoId}-chat`, cwd: project, status: "active", projectManager: true, allowedHarnesses: ["codex"], maxWorkers: 3, cli: "synthetic", continuations: 0, requests: {}, tasks,
  dispatches: tasks.map(item => ({ id: `dispatch-${item.id}`, taskId: item.id, sessionId: item.sessionId, workspace: { id: `workspace-${item.id}`, projectCwd: project, checkoutCwd: project, kind: "main" }, state: item.id === "review" ? "blocked" : item.status === "completed" ? "completed" : "running", stage: item.id === "review" ? "session_prepared" : "turn_submitted", startedAt: now - (item.id === "build" ? 402_000 : item.id === "calendar-work" ? 268_000 : item.id === "pricing-work" ? 1_410_000 : 360_000), updatedAt: now - 60_000,
    ...(item.id === "review" ? {} : { turnBlockId: item.id === "build" ? "builder-turn" : item.id === "calendar-work" ? "backend-turn" : "pricing-turn" }),
    ...(item.status === "completed" ? { finishedAt: now - 720_000, reportedAt: now - 710_000 } : {}) })),
});
const runs = [run("mono-engine", "mono-manager", monoProject, [builder, reviewer]), run("dz-engine", "dz-manager", dzProject, [backend, pricing])];
orchestrator.snapshot = () => runs;
orchestrator.subscribe = () => () => {};
orchestrator.hydrate = async () => {};
const pr: GitPr = { number: 1861, title: "Correct Arabic pricing labels", url: pricing.prUrl!, state: "merged", headOid: "synthetic", headRefName: "synthetic-pricing", baseRefName: "nour", additions: 3, deletions: 3, checksStatus: "success", reviewDecision: "APPROVED", mergeable: "MERGEABLE", mergeStateStatus: "CLEAN", updatedAt: new Date(now - 720_000).toISOString(), closedAt: new Date(now - 720_000).toISOString() };
const statuses = new Map([[prStatusKey(dzProject, pr.url), pr]]);
if (params.get("pr") === "open") recordPullRequest(monoProject, { ...pr, number: 42, url: "https://github.com/synthetic/monocode/pull/42", state: "open", headRefName: "nour" });
mockWindows("main");
mockIPC((command, args) => {
  if (command === "git_worktrees") {
    const project = String(args?.cwd ?? monoProject);
    return { worktrees: [{ path: project, branch: "nour", head: "synthetic", isMain: true, locked: false, prunable: false, missing: false, dirty: false, unpushed: 0, sessionIds: [] },
      ...Array.from({ length: project === monoProject ? 12 : 1 }, (_, index) => ({ path: `${project}/work-${index}`, branch: index === 0 ? "cc7n-dirty" : `history-${index}`, head: "synthetic", isMain: false, locked: false, prunable: false, missing: false, dirty: index === 0, unpushed: 0, sessionIds: [] }))], defaultRoot: project };
  }
  if (["git_pr_list", "list_external_editors", "list_project_files", "list_skills", "list_agent_files", "list_automations"].includes(command)) return [];
  if (command === "git_diff_index") return { files: [], upstream: null, ahead: 0, behind: 0, additions: 0, deletions: 0 };
  return null;
}, { shouldMockEvents: true });

type FixtureEvent = { action: string; target?: GoalTarget; text?: string; submission?: MonoGoalSubmission };
declare global { interface Window { missionFixture: { events: FixtureEvent[]; finishSubmission: (accepted: boolean) => void } } }
const events: FixtureEvent[] = [];
const context = { ownerId: "grand", projects: [{ id: monoProject, name: "MonoCode", path: monoProject, managerMonoId: "mono-manager", available: true }, { id: dzProject, name: "DZDistro", path: dzProject, managerMonoId: "dz-manager", available: true }] };
window.missionFixture = { events, finishSubmission: () => {} };

function Fixture() {
  const [open, setOpen] = useState(true);
  const zero = params.get("goals") === "zero";
  const input = { goals: zero ? goals.filter(item => item.state === "done") : goals, roster, runs, sessions, now };
  const view = selectGoalViews(input);
  const cockpit = selectCockpit(input, statuses);
  const onOpenTarget = (target: GoalTarget) => { events.push({ action: "open", target }); };
  return <div className="cc7n-fixture-shell">
    <aside className="cc7n-fixture-rail @container/sidebar" aria-label="Fixture sidebar">
      <strong className="cc7n-fixture-brand">MonoCode</strong><button className="cc7n-fixture-nav" onClick={() => setOpen(true)}>Mission control</button>
      <div className="cc7n-fixture-heading">Projects</div>
      {[monoProject, dzProject].map(project => <section key={project} aria-label={`${project.split("/").at(-1)} sidebar`}><div className="cc7n-fixture-project">{project.split("/").at(-1)}</div>
        <ProjectWorktrees project={project} currentProject={monoProject} enabled history={[]} openSessions={[]} busySessionIds={new Set(["builder-chat", "backend-chat"])} approvalSessionIds={new Set(["dz-manager-chat"])} unseenFinishedIds={new Set()} liveAgents={[]}
          onLoadHistory={async () => true} onSelectWorktree={(_project, tree) => events.push({ action: "worktree", text: tree.path })} onNewSession={() => {}} onSelectSession={id => events.push({ action: "session", text: id })}
          renderManager={() => <ProjectManagerRow project={project} sessions={sessions} onOpen={async () => onOpenTarget({ monoId: project === monoProject ? "mono-manager" : "dz-manager" })} onOpenMember={async id => onOpenTarget({ monoId: id })} />} />
      </section>)}
    </aside>
    <main className="cc7n-fixture-main">
      <MissionControlView view={view} cockpit={cockpit} attentionInput={input} timeline={id => selectGoalTimeline({ ...input, goalId: id })} open={open} onClose={() => setOpen(false)} onOpenTarget={onOpenTarget}
        renderAttention={close => <AttentionQueueView input={input} open onClose={close} presentation="panel" callbacks={{
          inspect: id => onOpenTarget({ requestSessionId: id }),
          approval: async (id, requestId, decision) => { events.push({ action: "approval", text: `${id}:${requestId}:${decision}` }); },
          repair: async id => { events.push({ action: "repair", text: id }); throw Error("Synthetic repair failed; both files remain preserved."); },
          compare: async () => ({ monoContent: "Synthetic Mono instructions", sourceContent: "Synthetic account instructions" }),
          reveal: async id => { events.push({ action: "reveal", text: id }); },
        }} />}
        command={<MissionCommandBar open={open} goalRouting={context} onSubmit={async (text, submission) => {
          events.push({ action: "submit", text, submission });
          if (params.get("submit") === "deferred") return new Promise(resolve => { window.missionFixture.finishSubmission = resolve; });
          return params.get("submit") !== "reject";
        }} />} />
      {!open && <p>Mission control closed<button onClick={() => setOpen(true)}>Reopen Mission control</button></p>}
    </main>
    <style>{`.cc7n-fixture-shell{display:grid;grid-template-columns:218px minmax(0,1fr);height:100dvh;background:var(--color-background-base);color:var(--color-content);font:13px/1.5 var(--font-sans)}.cc7n-fixture-rail{min-width:0;overflow:auto;padding:22px 14px;background:color-mix(in srgb,var(--color-background-base) 92%,black);border-right:1px solid var(--color-stroke)}.theme-light .cc7n-fixture-rail{background:#f0f0f0}.cc7n-fixture-brand{display:block;margin:0 10px 24px;font-size:16px}.cc7n-fixture-nav{display:block;width:100%;padding:9px 11px;border-radius:6px;background:var(--color-selection);font-size:12px;text-align:left}.cc7n-fixture-heading{margin:26px 10px 12px;font-size:11px;opacity:.72}.cc7n-fixture-project{margin:12px 10px 4px;font-size:12px}.cc7n-fixture-main{display:flex;min-width:0;min-height:0}.cc7n-fixture-main>.mission-control{flex:1}@media(max-width:1200px){.cc7n-fixture-shell{grid-template-columns:196px minmax(0,1fr)}}@media(max-width:1000px){.cc7n-fixture-shell{grid-template-columns:174px minmax(0,1fr)}.cc7n-fixture-rail{padding-inline:9px}}@media(max-width:850px){.cc7n-fixture-shell{grid-template-columns:158px minmax(0,1fr)}}`}</style>
  </div>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
