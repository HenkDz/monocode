import React, { useState, useRef, useEffect, useCallback, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { mockIPC } from "@tauri-apps/api/mocks";
import AppMapHost from "virtual:app-map-host";
import { listMonos, findMono, monoLook, subscribeMonos, monosSnapshot, saveMonoTeamRoster, type Mono } from "../../src/features/monos/model/mono";
import { monoManagerGoals, type MonoManagerGoal } from "../../src/features/monos/model/monoManagerGoals";
import type { MonoDecision } from "../../src/features/monos/model/monoDecisions";
import { sendDecisionFromClick } from "../../src/features/monos/model/monoDecisionUi";
import { ensureMonoSession } from "../../src/features/monos/model/monoWorkspace";
import { monoGoalRoutingContext, type MonoGoalSubmission } from "../../src/features/monos/model/monoGoalRouting";
import { sameProjectPath } from "../../src/features/projects/model/recents";
import { projectKey } from "../../src/shared/lib/paths";
import { newSession, type Session } from "../../src/features/sessions/model/session";
import { PROVIDER_ACCOUNT_PROVIDERS } from "../../src/features/providers/model/providerAccounts";
import type { OrchestrationRun, OrchestrationTask } from "../../src/features/orchestration/model/orchestrationState";
import { TeamMap } from "../../src/features/teamMap/TeamMap";
import { commandMapDecisions } from "../../src/features/teamMap/commandMapDecisions";
import { capabilityDecisionReason } from "../../src/features/integrations/model/integrationCapabilities";
import { INTEGRATIONS_SCOPE } from "../../src/features/integrations/model/projectIntegrations";
import { useTeamMap } from "../../src/features/teamMap/navigation";
import { recordPullRequest } from "../../src/features/source-control/model/pullRequests";
import { prStatusKey } from "../../src/features/source-control/hooks/usePrStatus";
import type { GitPr } from "../../src/platform/tauri/fs";
import { GoalNextAction } from "../../src/features/commandCenter/ui/GoalNextAction";
import { selectGoalNextAction, runGoalNextAction, type GoalNextStep } from "../../src/features/commandCenter/model/goalNextAction";
import { selectDecisionView, selectNeedsUser } from "../../src/features/commandCenter/model/decisionView";
import { AttentionQueueView } from "../../src/features/commandCenter/ui/AttentionQueue";
import { deferUnhandledEscape, focusedBusyAgentSessionId, shouldStopFocusedTurnOnEscape } from "../../src/features/workspace/model/tabKeys";
import "../../src/styles/index.css";

const query = new URLSearchParams(location.search), now = Date.now();
document.documentElement.classList.toggle("theme-light", query.get("theme") === "light");
const savedMapPreference = query.has("persist") ? localStorage.getItem("monocode:team-map-orbit") : null;
localStorage.clear(); document.body.style.margin = "0";
const names = ["browser-link-4", "dzdistro", "monocode", "guilds"];
const paths = names.map(name => `C:/synthetic/${name}`);
const managers = ["browser-link-4 Manager", "dzdistro Manager", "CC Coordinator", "guilds Manager"];
const members = [["Atlas", "Sentinel", "Forge"], ["Nova"], ["Ada", "Vale"], ["Atlas", "Mira"]];
if (query.has("real")) members[2].push("Forge", "Iris", "Sage", "Atlas", "Sentinel");
const colors = ["#7aa2ff", "#5ed3b8", "#c9a7ff", "#e6b463"];
const roster: Mono[] = [{ id: "boss", name: "Boss", role: "orchestrator", projects: paths, sessionId: "boss-chat", mascot: "owl", color: colors[2] }];
names.forEach((_, i) => {
  roster.push({ id: `manager-${i}`, name: managers[i], role: "manager", managerEngineId: `engine-${i}`, sessionId: `manager-chat-${i}`, reportsTo: "boss", managerProject: paths[i], projects: [paths[i]], mascot: ["cat", "fox", "owl", "cat"][i], color: colors[i] });
  members[i].forEach((name, j) => roster.push({ id: `member-${i}-${j}`, name, role: "member", reportsTo: `manager-${i}`, projects: [paths[i]], sessionId: `member-chat-${i}-${j}`, specialty: name === "Vale" || name === "Sentinel" ? "Reviewer" : "Builder", mascot: j % 2 ? "owl" : "cat", color: colors[i] }));
});
localStorage.setItem("monocode:mono-roster", JSON.stringify(roster));
localStorage.setItem("monocode:team-map-orbit", savedMapPreference ?? JSON.stringify({ view: query.get("legacy") ?? "orbit", order: names.map((_, i) => `manager-${i}`), focus: "manager-2" }));
const goalTitles = [["Profile routing + one-time Open"], ["Distributor invoicing export"], ["Calm navigation & summaries (CC-UX2)", "Integrations: Composio (V4b)"], ["ChatGPT plan sign-in"]];
const goals: MonoManagerGoal[] = goalTitles.flatMap((titles, i) => titles.map((title, j) => ({ id: `goal-${i}-${j}`, monoId: `manager-${i}`, managerId: `engine-${i}`, projectId: paths[i], userMessageId: `goal-request-${i}-${j}`, requestId: `request-${i}-${j}`, title, state: "running", prUrls: [], createdAt: now - 600000, updatedAt: now - 1000 })));
const taskRows = [
  [["Fix 3 review comments", 0, "running"], ["Re-review latest change", 1, "queued"], ["Keep browser in foreground", 2, "ready"], ["Route cache cleanup", 0, "done"]],
  [["CSV export", 0, "done"], ["Legacy XLS?", 0, "queued"], ["Email distributors", 0, "queued"]],
  [["Build the 17 fixes", 0, "done"], ["Independent review", 1, "completed"], ["Release gates + C7 build", 0, "running"], ["Provider spike", 0, "done"], ["Review spike findings", 1, "completed"], ["Connector contract", -1, "queued"]],
  [["Session backend", 0, "completed"], ["GitHub one-click auth", 1, "queued"]],
] as const;
const statuses = new Map<string, GitPr | null>();
const initialSessions: Session[] = roster.map(mono => ({ ...newSession("codex", mono.role === "orchestrator" ? "C:/synthetic/boss" : mono.projects[0]), id: mono.sessionId!, title: mono.name }));
const runs: OrchestrationRun[] = taskRows.map((rows, i) => {
  const tasks: OrchestrationTask[] = rows.map(([title, member, state], j) => {
    const id = `task-${i}-${j}`, sessionId = `worker-${i}-${j}`, dispatchId = `dispatch-${i}-${j}`;
    const workspace = { id: `checkout-${i}-${j}`, projectCwd: paths[i], checkoutCwd: `${paths[i]}-worktree-${j}`, kind: "worktree" as const, branch: ["profile-routing", "review", "fix/foreground"][j % 3] };
    const task: OrchestrationTask = { id, monoGoalId: `goal-${i}-${i === 2 && j > 2 ? 1 : 0}`, sessionId, ...(member >= 0 ? { memberId: `member-${i}-${member}`, memberName: members[i][member] } : {}),
      title, prompt: `Implement the assigned task: ${title}. Preserve the project guards and report the result.`, status: state === "done" || state === "ready" ? "completed" : state,
      accepted: state === "done" || state === "ready", acceptedDispatchId: state === "done" || state === "ready" ? dispatchId : undefined,
      lastDispatchId: dispatchId, activeDispatchId: state === "running" ? dispatchId : undefined,
      harness: "codex", model: "synthetic-model", files: [], scopes: [], dependsOn: [], delivered: state === "done", result: state === "done" ? "Focused checks passed. Report saved." : "", workspace,
      completionOutcome: state === "done" ? "no-changes" : undefined, baseBranch: "main" };
    if (state === "ready") {
      const pr: GitPr = { number: 39, url: "https://github.com/synthetic/browser-link/pull/39", title, state: "open", isDraft: false, headOid: "approved-current-head", headRefName: workspace.branch, baseRefName: "main", reviewDecision: "APPROVED", checksStatus: "success", mergeable: "MERGEABLE", mergeStateStatus: "CLEAN" };
      task.prUrl = pr.url; task.reviewedHead = pr.headOid; task.delivery = { head: pr.headOid!, ci: "pass", state: "ready", conflicts: false, mergeable: true };
      statuses.set(prStatusKey(workspace.checkoutCwd, pr.url), pr);
      recordPullRequest(workspace.checkoutCwd, pr, { sessionId, sessionTitle: title, taskId: id, acceptedHead: pr.headOid, turnId: `turn-${id}`, blockId: `block-${id}`, at: now - 1000 });
    }
    initialSessions.push({ ...newSession("codex", workspace.checkoutCwd), id: sessionId, busy: state === "running", blocks: [
      { id: `turn-${id}`, role: "user", text: task.prompt, startedAt: now - 840000, durationMs: state === "running" ? undefined : 5000, turnMetrics: { inputTokens: 0, outputTokens: 0, endedAt: state === "running" ? undefined : now - 835000 }, turnModel: { harness: "codex", id: "synthetic-model", name: "Recorded fixture model" } },
      { id: `reply-${id}`, role: "assistant", text: state === "running" ? "Running release gates" : state === "completed" ? "Waiting for independent review" : state === "ready" ? "Current head approved; checks passed" : state === "done" ? "Report saved" : "Not started yet" },
    ] });
    return task;
  });
  return { version: 2, leadId: `engine-${i}`, ownerMonoId: `manager-${i}`, ownerSessionId: `manager-chat-${i}`, cwd: paths[i], projectManager: true, projectName: names[i], status: "active", allowedHarnesses: ["codex"], maxWorkers: 1, cli: "synthetic", continuations: 0, requests: {}, tasks,
    dispatches: tasks.map(task => ({ id: task.lastDispatchId!, taskId: task.id, sessionId: task.sessionId, workspace: task.workspace!, state: task.status === "queued" ? "starting" : task.status === "running" ? "running" : "completed", stage: "turn_submitted", startedAt: now - 840000, updatedAt: now - 1000, turnStartedAt: now - 840000, turnBlockId: `turn-${task.id}`, ...(task.status === "completed" ? { finishedAt: now - 835000, durationMs: 5000 } : {}) })) };
});
if (query.has("real")) {
  const raw = "Continue and complete the already authorized Build profile routing and one-time Open with workflow; preserve the exact authorization and all previous work. ".repeat(4);
  goals.find(goal => goal.id === "goal-2-0")!.title = raw;
  goals.find(goal => goal.id === "goal-2-1")!.title = "Connector contract\nRAW_MULTILINE_SENTINEL internal implementation instructions";
  initialSessions.push({ ...newSession("codex", paths[2]), id: "exact-goal-origin", title: "Browser profile routing", blocks: [{ id: "goal-request-2-0", role: "user", text: raw }] });
  initialSessions.push({ ...newSession("codex", paths[2]), id: "later-unrelated", title: "UNRELATED_TITLE_SENTINEL", blocks: [{ id: "earlier-turn", role: "user", text: "Different request" }, { id: "goal-request-2-1", role: "user", text: "Later unrelated request" }] });
  runs[2].tasks[2].title = "Release gates and review the complete browser profile routing experience across Windows and Linux with preserved session history";
  const template = runs[2].tasks[0];
  for (let i = 0; i < 15; i++) {
    const id = `terminal-${i}`, dispatchId = `terminal-attempt-${i}`;
    runs[2].tasks.push({ ...template, id, title: `Saved change ${i} with complete recorded task history`, status: i === 14 ? "failed" : i === 13 ? "cancelled" : "completed", lastDispatchId: dispatchId, acceptedDispatchId: dispatchId });
    runs[2].dispatches!.push({ ...runs[2].dispatches![0], id: dispatchId, taskId: id, finishedAt: now - 500 + i, updatedAt: now - 500 + i, state: "completed" });
  }
}
const ask: MonoDecision = { version: 1, type: "decision", id: "xls", projectId: paths[1], goalId: "goal-1-0", taskId: "task-1-1", requestingMonoId: "member-1-0", requesterSessionId: "worker-1-1", question: "Support the legacy XLS invoice template?", impact: "high", context: "3 distributors still upload XLS. Supporting it adds about one day and a parser to maintain.", operation: "work", options: [{ id: "csv", label: "CSV only, announce deprecation" }, { id: "xls", label: "Support XLS too" }], recommendedOptionId: "csv", escalationChain: [{ id: "member-1-0", level: "worker" }, { id: "manager-1", level: "manager" }, { id: "boss", level: "boss" }, { id: "user", level: "user" }], answererId: "user", status: "waiting", createdAt: now - 60000 };
const launchAsk = { ...ask, id: "launch", projectId: paths[2], goalId: "goal-2-0", taskId: undefined, requestingMonoId: "member-2-1", requesterSessionId: "worker-2-1", question: "Launch Checkpoint 7 on your test profile?", impact: "med" as const, context: "The team recorded a checkpoint ready for your decision.", options: [{ id: "now", label: "Launch now" }, { id: "later", label: "Later" }], recommendedOptionId: "now", escalationChain: [{ id: "member-2-1", level: "worker" as const }, { id: "manager-2", level: "manager" as const }, { id: "boss", level: "boss" as const }, { id: "user", level: "user" as const }] };
const store = new Map(names.map((_, i) => [`mono-goals:manager-${i}`, JSON.stringify({ version: 1, goals: goals.filter(goal => goal.monoId === `manager-${i}`), receipts: {}, decisions: i === 1 ? [ask] : i === 2 ? [launchAsk] : [] })]));
localStorage.setItem("monocode:crew-messages", JSON.stringify([
  { id: "today-1", managerId: "manager-2", senderId: "member-2-0", recipientId: "manager-2", topic: "report", text: "Ada finished the UX fixes", summary: "Ada finished the UX fixes", at: now - 60000 },
  { id: "today-2", managerId: "manager-0", senderId: "member-0-1", recipientId: "manager-0", topic: "review", text: "Sentinel approved the foreground change", summary: "Sentinel approved the foreground change", at: now - 120000 },
  { id: "today-3", managerId: "manager-1", senderId: "member-1-0", recipientId: "manager-1", topic: "question", text: "Nova asked about XLS support", summary: "Nova asked about XLS support", at: now - 180000 },
]));
const sends: { sessionId: string; text: string; attachments: unknown[] }[] = [], bossGoals: MonoGoalSubmission[] = [], native: string[] = [], stops: string[] = [];
let refuse = false, releasePrepare: (() => void) | undefined, preparation: Promise<void> | undefined, refreshFixture = () => {};
mockIPC((command, args) => {
  native.push(command);
  if (command === "control_load") return store.get((args as { leadId: string }).leadId) ?? null;
  if (command === "control_save") { const value = args as { leadId: string; state: string }; store.set(value.leadId, value.state); return; }
  if (command === "artifacts_get" || command === "artifact_get") return null;
  throw Error(`Unexpected native fixture operation ${command}`);
});
const controls = { sends, bossGoals, native, stops, refuse: (value: boolean) => { refuse = value; },
  hold: () => { preparation = new Promise(resolve => { releasePrepare = resolve; }); }, release: () => { releasePrepare?.(); preparation = undefined; },
  archive: (id: string) => saveMonoTeamRoster(listMonos(true).map(mono => mono.id === id ? { ...mono, archivedAt: now } : mono)),
  arrive: () => {
    const template = runs[2].tasks[2];
    for (let i = 0; i < 22; i++) runs[2].tasks.push({ ...template, id: `arriving-${i}`, title: `New incoming task ${i}`, activeDispatchId: undefined, lastDispatchId: undefined, status: "queued" });
    refreshFixture();
  },
  renameTitle: (title: string) => { runs[2].tasks[2].title = title; refreshFixture(); },
};
declare global { interface Window { ccmapFixture: typeof controls } }
window.ccmapFixture = controls;
const noop = () => {};
function Fixture() {
  const teamMap = useTeamMap(), [sessions, setSessions] = useState(initialSessions);
  const [, refresh] = useState(0); refreshFixture = () => refresh(value => value + 1);
  const sessionsRef = useRef(sessions); sessionsRef.current = sessions;
  const monoViewIdRef = useRef("worker-2-2"), activeTabIdRef = useRef("synthetic-tab"), tabsRef = useRef([]), projectTerminalFocusedRef = useRef(false);
  useSyncExternalStore(monoManagerGoals.subscribe, monoManagerGoals.snapshot);
  const submit = async (sessionId: string, text: string, attachments: unknown[]) => { if (refuse) return false; sends.push({ sessionId, text, attachments }); return true; };
  const submitSessionRef = useRef(submit); submitSessionRef.current = submit;
  const input = { roster: listMonos(), runs, sessions, goals: monoManagerGoals.goals() };
  const steps = input.goals.flatMap(goal => { const step = selectGoalNextAction(input, goal.id); return step ? [step] : []; });
  const needs = selectNeedsUser(input.roster, sessions, runs, selectDecisionView(monoManagerGoals, input.roster, now), steps, input);
  const renderAttention = (project?: string) => {
    const ids = project && new Set(needs.sources.filter(source => sameProjectPath(source.project, project)).map(source => source.key));
    return <AttentionQueueView open integrated presentation="panel" input={input} items={ids ? needs.attention.filter(item => ids.has(item.id)) : needs.attention} onClose={teamMap.close} callbacks={{ inspect: noop }} />;
  };
  useEffect(() => teamMap.show(), []);
  const ports = { React, useState, useRef, useEffect, useCallback, useSyncExternalStore, subscribeMonos, monosSnapshot, monoManagerGoals, listMonos, findMono, teamMap, sendDecisionFromClick,
    monoViewIdRef, workerSelectedSessionIdRef: monoViewIdRef, activeTabIdRef, tabsRef, projectTerminalFocusedRef, focusedBusyAgentSessionId, shouldStopFocusedTurnOnEscape, deferUnhandledEscape, onStop: (id: string) => { stops.push(id); },
    ensureOpenSession: async (id: string) => { await preparation; return sessionsRef.current.find(session => session.id === id); }, ensureMonoSession,
    homeDir: async () => "C:/synthetic/home", saveMonoPermissions: async () => {}, newDefaultSession: (cwd: string) => newSession("codex", cwd), selectedProviderAccountId: () => "fixture-account", PROVIDER_ACCOUNT_PROVIDERS,
    sessionsRef, setSessions, submitSessionRef, submitSession: submit, submitMonoGoalRef: { current: async (_id: string, _text: string, _attachments: unknown[], request: MonoGoalSubmission) => { bossGoals.push(request); return true; } },
    sameProjectPath, monoLook, monoGoalRoutingContext, remoteProjectFor: () => undefined, recents: paths.map(path => ({ path })), projectKey,
    workspaceNavigation: { cancel: noop }, setFilePickerOpen: noop, setSettingsOpen: noop, setSearchViewOpen: noop, setInboxViewOpen: noop, setNotesViewOpen: noop, setAutomationsViewOpen: noop,
    MISSION_CONTROL_SCOPE: "mission", ATTENTION_QUEUE_SCOPE: "attention", DECISIONS_SCOPE: "decisions", USAGE_DASHBOARD_SCOPE: "usage", INTEGRATIONS_SCOPE,
    capabilityDecisionReason, renderIntegrationRequest: () => null, TeamMap, sessions, orchestrationRuns: runs, managerPrStatuses: statuses, onOpenMono: noop, onOpenRailMono: noop, commandMapDecisions,
    goalNextSteps: steps, renderGoalNextAction: (step: GoalNextStep) => <GoalNextAction key={step.revision} step={step} onAction={(event, step) => runGoalNextAction(event, step, { read: () => selectGoalNextAction(input, step.goalId), open: async () => {}, continueManager: async () => {}, continueRequest: async () => {}, pending: new Set(), accepted: new Set() })} />,
    attentionInput: input, renderNeedsUserAttention: renderAttention,
  };
  return <main style={{ height: "100vh", display: "flex", flexDirection: "column" }}><AppMapHost {...ports} /></main>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
