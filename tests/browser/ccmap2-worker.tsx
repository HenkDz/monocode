import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
// @ts-expect-error Actual App source is transformed by the fixture plugin.
import { bindWorkerApp } from "virtual:ccmap2-worker";
import { createWorkerFixture } from "./ccmap2WorkerFixture";
import { SessionPane, type SessionPaneProps } from "../../src/features/sessions/ui/SessionPane";
import { WorkerConversationPicker } from "../../src/features/monos/ui/WorkerConversationPicker";
import { publishCardSessions } from "../../src/features/monos/model/monoCards";
import { orchestrator } from "../../src/features/orchestration/model/orchestration";
import { TeamMap } from "../../src/features/teamMap/TeamMap";
import { Modal } from "../../src/shared/ui/Modal";
import { WorkspaceGoals } from "../../src/app/shell/WorkspaceContext";
import { monoManagerGoals } from "../../src/features/monos/model/monoManagerGoals";
import { registerHarness } from "../../src/integrations/harness/core/registry";
import { setHarnessModels } from "../../src/features/sessions/model/models";
import { selectAgentLiveState } from "../../src/features/agents/model/agentLiveState";
import "../../src/styles/index.css";

const f = createWorkerFixture(bindWorkerApp), h = f.host, noop = () => {};
mockWindows("main");
mockIPC((command) => {
  if (command === "git_branches") return { current: "feature", local: [], remote: [] };
  if (command === "git_diff_index") return { files: [], additions: 0, deletions: 0 };
  if (["list_dir", "git_nested_worktrees", "list_project_files", "list_external_editors", "list_skills", "list_agent_files", "list_automations", "git_pr_list", "org_artifacts_list"].includes(command)) return [];
  return null;
}, { shouldMockEvents: true });
const forbiddenProvider = async () => { throw Error("Provider execution is outside fixture authority"); };
registerHarness({ id: "codex", live: true, canSteer: true, sendTurn: forbiddenProvider, steerTurn: forbiddenProvider, cancelTurn: forbiddenProvider,
  respondApproval: noop, stopSession: forbiddenProvider, forgetSession: async () => {}, bindSession: noop });
setHarnessModels("codex", [{ id: "codex:fixture", harness: "codex", name: "Fixture Codex", settings: [] }]);
Object.assign(orchestrator, { snapshot: () => h.orchestrationRuns, hydrate: async () => {}, forSession: () => f.run, run: () => f.run });
const goal = { id: "fixture-goal", managerId: "engine", monoId: "manager", projectId: f.project, title: "Fixture goal", userMessageId: "u-manager-home", state: "running", createdAt: 100, updatedAt: 100 };
Object.assign(monoManagerGoals, { goals: () => [goal], subscribe: () => noop, snapshot: () => 1 });
f.run.tasks.forEach(task => { task.monoGoalId = goal.id; });
const props: Omit<SessionPaneProps, "session" | "visible" | "focused" | "inSplit" | "composerFocused"> = {
  recents: [], onFocus: h.onFocusPane, onClose: noop, onCwdChange: noop, onBranchChange: noop, onWorkspaceModeChange: noop, onWorktreeBaseChange: noop,
  onModelChange: noop, onModelSettingsChange: noop, onRuntimeModeChange: noop,
  onSubmit: (id, text, attachments, options) => { f.events.push({ action: "submit", id, text, attachments, options }); return false; },
  onSaveDraft: noop, onRemoveDraft: noop, onStop: h.onStop, onCompactContext: () => false, onPlaceSessionInFolder: noop,
  onDeleteQueuedMessage: noop, onEditQueuedMessage: noop, onQueuedMessageEditingChange: noop, onSteerQueuedMessage: noop, onResumeQueue: noop,
  onUsageLimitResume: noop, onUsageLimitResumeAtReset: noop, onUsageLimitDismiss: noop, onCodexStorageRepair: async () => {},
  onApproval: (id, requestId, decision) => { f.events.push({ action: "approval", id, requestId, decision }); },
  onQuestionReply: noop, onOpenFile: noop, onOpenDiff: noop, onOpenPlan: noop, onBuildPlan: noop, onNewTerminal: noop,
};
Object.assign(h, { React, WorkerConversationPicker, SessionPane, Modal, TeamMapHeaderAction: () => null, sessionPaneProps: props });
publishCardSessions(f.sessions.map(session => ({ id: session.id, title: session.title, harness: session.harness, busy: !!session.busy, needsInput: false, liveState: selectAgentLiveState(session) })), h.openCard);
function Fixture() {
  const [, update] = useState(0), [goalPanel, setGoalPanel] = useState(false);
  f.onRefresh(() => update(value => value + 1)); h.refreshFocus();
  useEffect(() => h.registerEscape(), []);
  useEffect(() => { h.recordVisit(); }, [h.monoViewId, h.workerPages]);
  return <div style={{ position: "fixed", inset: 0, display: "flex", flexDirection: "column", background: "var(--color-background-base)", color: "var(--color-content)" }}>
    <nav style={{ display: "flex", gap: 12, padding: 10, fontSize: 12, flexWrap: "wrap", flex: "none" }}>
      <button onClick={() => h.onOpenRailMono("worker")}>Sidebar Vale</button><button onClick={() => h.onSelectTitleTab(h.monoTabId("worker"))}>Title Vale</button>
      <button onClick={() => { h.teamMap.open = true; f.refresh(); }}>Map</button><button onClick={() => setGoalPanel(value => !value)}>Goal panel</button>
      <button onClick={() => h.onOpenApprovalSession("task-a")}>Notification A</button><button onClick={() => h.openReminderSession("past-a")}>Reminder history</button>
      <button onClick={() => h.onVisitBack()}>Back</button><button onClick={() => h.onVisitForward()}>Forward</button>
      <output data-shell-state>{JSON.stringify({ mono: h.monoViewId, active: h.activeSessionId, tabs: h.tabs.map((tab: any) => tab.id), monoTabs: h.openMonoTabs })}</output>
    </nav>
    <div style={{ flex: 1, minHeight: 0, display: "flex", position: "relative" }}>
      {h.teamMap.open ? <TeamMap sessions={h.sessions} runs={h.orchestrationRuns} statuses={new Map()} onClose={h.teamMap.close} onOpenMono={h.onOpenRailMono} />
        : <div style={{ position: "relative", flex: 1, minWidth: 0 }}>{h.renderPages()}</div>}
      {goalPanel && <div style={{ width: 270, overflow: "auto" }}><WorkspaceGoals project={f.project} sessions={h.sessions} onOpenMono={h.onOpenRailMono} /></div>}
    </div>
  </div>;
}
Object.assign(window, { ccmap2Worker: { ...f, open: h.openWorkerTask, state: () => ({ mono: h.monoViewId, active: h.activeSessionId, targets: h.workerPages, tabs: h.tabs, monoTabs: h.openMonoTabs }),
  approval: () => { h.setSessions(h.sessions.map((session: any) => session.id === "task-a" ? { ...session, blocks: [...session.blocks, { id: "approval", role: "approval", text: "exact worker approval", approval: { requestId: 42 } }] } : session)); },
} });
createRoot(document.getElementById("root")!).render(<Fixture />);
