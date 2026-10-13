import { useState } from "react";
import { createRoot } from "react-dom/client";
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { configureChildBackend, startHarnessBridge } from "../../src/integrations/harness/core/child";
import { registerHarness } from "../../src/integrations/harness/core/registry";
import { SessionPane, type SessionPaneProps } from "../../src/features/sessions/ui/SessionPane";
import { TreeMap } from "../../src/features/teamMap/TeamMap";
import { recordCrewMessage } from "../../src/features/monos/model/monoCrewEvents";
import { orchestrator } from "../../src/features/orchestration/model/orchestration";
import type { OrchestrationRun, OrchestrationTask } from "../../src/features/orchestration/model/orchestrationState";
import type { Mono } from "../../src/features/monos/model/mono";
import { newSession, type HarnessId } from "../../src/features/sessions/model/session";
import "../../src/styles/index.css";

const params = new URLSearchParams(location.search);
const mode = params.get("mode") ?? "auth";
const count = Number(params.get("members") ?? 4);
const projects = Number(params.get("projects") ?? 1);
const harness = (params.get("provider") ?? "codex") as HarnessId;
const scenario = params.get("scenario") ?? "auth";
const raw = params.get("error") ?? "HTTP 401 Unauthorized\r\nMissing bearer token\r\ncf-ray: synthetic\r\nrequest: keep every byte";
const events: { action: string; args?: unknown }[] = [];
const listeners = new Map<string, (event: { payload: unknown }) => void>();
let spawnId = "";
mockWindows("ccauth-synthetic");
document.documentElement.classList.toggle("theme-light", params.get("theme") === "light");
Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (text: string) => { Object.assign(window, { copiedDiagnostics: text }); } } });
mockIPC(command => {
  if (command === "home_dir") return "C:/synthetic/ccauth-home";
  if (["git_pr_list", "list_external_editors", "list_project_files", "list_skills", "list_agent_files", "org_artifacts_list", "git_nested_worktrees", "provider_accounts_list"].includes(command)) return [];
  if (command === "git_diff_index") return { files: [], upstream: null, ahead: 0, behind: 0, additions: 0, deletions: 0 };
  return null;
}, { shouldMockEvents: true });
configureChildBackend({
  async invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
    if (command.startsWith("harness_resolve_")) return { path: `C:/synthetic/bin/${harness}` } as T;
    if (command === "harness_spawn") { events.push({ action: "login", args }); spawnId = String(args?.sessionId); return 424242 as T; }
    if (command === "harness_write") throw Error("Provider turns forbidden in fixture");
    return null as T;
  },
  async listen<T>(name: string, handler: (event: { payload: T }) => void) {
    listeners.set(name, handler as (event: { payload: unknown }) => void);
    return () => { listeners.delete(name); };
  },
});
const release = startHarnessBridge();
window.addEventListener("pagehide", release, { once: true });
registerHarness({ id: harness, live: true, canSteer: true,
  sendTurn: async () => { throw Error("No provider turns"); }, steerTurn: async () => { throw Error("No provider turns"); },
  cancelTurn: async () => {}, respondApproval: () => {}, stopSession: async () => {}, forgetSession: async () => {}, bindSession: () => {},
});
const roster: Mono[] = [
  { id: "grand", name: "Grand Orch", role: "orchestrator", projects: [], mascot: "cat", color: "#9caed1" },
  ...Array.from({ length: projects }, (_, project) => [
    { id: `manager-${project}`, sessionId: `manager-chat-${project}`, name: `Project ${project+1} Manager`, role: "manager" as const, reportsTo: "grand", projects: [`/project-${project+1}`], mascot: "cat", color: "#88b9ab" },
    ...Array.from({ length: count }, (_, worker) => ({ id: `worker-${project}-${worker}`, sessionId: `chat-${project}-${worker}`, name: ["Atlas","Forge","Iris","Sentinel"][worker] ?? `Worker ${worker+1}`, role: "member" as const, reportsTo: `manager-${project}`, projects: [`/project-${project+1}`], mascot: "cat", color: "#88b9ab" })),
  ]).flat(),
];
localStorage.setItem("monocode:mono-roster", JSON.stringify(roster));
const runs: OrchestrationRun[] = Array.from({ length: projects }, (_, project) => ({
  version: 2, leadId: `engine-${project}`, ownerMonoId: `manager-${project}`, ownerSessionId: `manager-chat-${project}`, cwd: `/project-${project+1}`,
  projectManager: true, status: mode === "auth" ? "paused" : "active", allowedHarnesses: [harness], maxWorkers: 1, cli: "synthetic", continuations: 0, requests: {}, dispatches: [],
  ...(mode === "auth" ? { error: scenario === "decision" ? "Approval required before integration" : raw } : {}),
  tasks: mode === "tree" && params.has("mixed") ? roster.filter(mono => mono.reportsTo === `manager-${project}`).map((mono,index) => ({
    id: `task-${mono.id}`, memberId: mono.id, sessionId: mono.sessionId!, title: `Task for ${mono.name}`, prompt: "Synthetic", harness, model: "synthetic", files: [], scopes: [], dependsOn: [], result: "", accepted: false, delivered: false,
    status: index % 4 === 1 ? "queued" : index % 4 === 2 ? "cancelled" : index % 4 === 3 ? "blocked" : "running",
  } as OrchestrationTask)) : [],
}));
orchestrator.snapshot = () => runs;
orchestrator.subscribe = () => () => {};
orchestrator.continueManager = async id => { events.push({ action: "continue", args: id }); };
orchestrator.hydrate = async () => {};
const treeSessions = roster.filter(mono => mono.role === "member").map((mono,index) => ({ ...newSession(harness, mono.projects[0]), id: mono.sessionId!, busy: !params.has("idle") && (!params.has("mixed") || index % 4 === 0) }));
const initialSession = { ...newSession(harness, "/project-1"), id: "manager-chat-0", providerAccountId: "synthetic-work", busy: scenario === "busy", blocks: [
  { id: "user", role: "user" as const, text: "Review this change and retain the held work." },
  ...(scenario === "decision" ? [] : [1,2].map(id => ({ id: `auth-${id}`, role: "system" as const, text: raw, notice: "error" as const }))),
], queuedMessages: [{ id: "held", text: "Retain this held prompt", attachments: [] }] };
const noop = () => {};
function Fixture() {
  const [session, setSession] = useState(initialSession);
  const [panel, setPanel] = useState(params.has("panel"));
  const props: SessionPaneProps = { session, visible: true, focused: true, inSplit: false, composerFocused: false, recents: [],
    onFocus: noop, onClose: noop, onCwdChange: noop, onBranchChange: noop, onWorkspaceModeChange: noop, onWorktreeBaseChange: noop,
    onModelChange: noop, onModelSettingsChange: noop, onRuntimeModeChange: noop,
    onSubmit: () => { events.push({ action: "submit" }); return false; }, onSaveDraft: noop, onRemoveDraft: noop, onStop: noop, onCompactContext: () => false,
    onPlaceSessionInFolder: noop, onDeleteQueuedMessage: noop, onEditQueuedMessage: noop, onQueuedMessageEditingChange: noop, onSteerQueuedMessage: noop,
    onResumeQueue: () => events.push({ action: "resume" }), onUsageLimitResume: noop, onUsageLimitResumeAtReset: noop, onUsageLimitDismiss: noop,
    onApproval: noop, onQuestionReply: noop, onOpenFile: noop, onOpenDiff: noop, onOpenPlan: noop, onBuildPlan: noop, onNewTerminal: noop,
  };
  Object.assign(window, { ccauthFixture: {
    events, raw, original: JSON.stringify({ session: initialSession, runs }), current: () => JSON.stringify({ session, runs }),
    finishLogin: (success: boolean) => {
      if (!success) listeners.get("harness-stderr")?.({ payload: { sessionId: spawnId, line: "401 cf-ray: synthetic-login-failure" } });
      listeners.get("harness-exit")?.({ payload: { sessionId: spawnId, pid: 424242, code: success ? 0 : 1 } });
    },
    repeat: () => setSession(value => ({ ...value, blocks: [...value.blocks, { id: `auth-${value.blocks.length}`, role: "system", notice: "error", text: raw }] })),
    pulse: (up = false) => recordCrewMessage({ id: `pulse-${Date.now()}`, managerId: "manager-0", senderId: up ? `worker-0-${Math.max(0,count-1)}` : "manager-0", recipientId: up ? "grand" : `worker-0-${Math.max(0,count-1)}`, topic: up ? "Report" : "Work", text: "Synthetic event", at: Date.now() }),
  } });
  return <div style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
    {mode === "tree" && <button aria-label="Toggle synthetic panel" onClick={() => setPanel(!panel)}>Panel</button>}
    <div style={{ display: "flex", minHeight: 0, flex: 1 }}>
      {mode === "tree" ? <TreeMap sessions={treeSessions} runs={runs} statuses={new Map()} onOpenMono={id => events.push({ action: "open", args: id })} onSelectMono={id => events.push({ action: "select", args: id })} onClose={noop} /> : <SessionPane {...props} />}
      {panel && <aside style={{ width: 320, flexShrink: 0, borderLeft: "1px solid var(--color-stroke)", padding: 16 }}>Synthetic selected agent panel</aside>}
    </div>
  </div>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
