import { useState } from "react";
import { createRoot } from "react-dom/client";
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { emit } from "@tauri-apps/api/event";
// @ts-expect-error supplied by the fixture's source-bound Vite plugin
import expressions from "virtual:ccfb2-shell";
import { TitleBar } from "../../src/app/shell/TitleBar";
import { WindowControls } from "../../src/app/shell/WindowControls";
import { IS_MAC } from "../../src/platform/tauri/platform";
import { AgentTranscript } from "../../src/features/sessions/ui/AgentTranscript";
import type { Block } from "../../src/features/sessions/model/session";
import { TeamMap } from "../../src/features/teamMap/TeamMap";
import { TeamMapNav } from "../../src/features/teamMap/navigation";
import { saveOrbitPreferences, loadOrbitPreferences } from "../../src/features/teamMap/orbit";
import { MissionControlNav, MissionControlView, MISSION_CONTROL_SCOPE } from "../../src/features/commandCenter/ui/MissionControl";
import { AttentionQueueNav, AttentionQueueView, ATTENTION_QUEUE_SCOPE } from "../../src/features/commandCenter/ui/AttentionQueue";
import { UsageDashboardNav, UsageDashboard, USAGE_DASHBOARD_SCOPE } from "../../src/features/providers/ui/UsageDashboard";
import { selectGoalViews } from "../../src/features/commandCenter/model/goalView";
import { selectCockpit } from "../../src/features/commandCenter/model/cockpit";
import { goals, roster, runs, sessions, now } from "../../src/features/commandCenter/fixtures/syntheticMission";
import "../../src/styles/index.css";

const params = new URLSearchParams(location.search);
document.documentElement.classList.toggle("theme-light", params.get("theme") === "light");
localStorage.setItem("monocode:mono-roster", JSON.stringify(roster));
saveOrbitPreferences({ ...loadOrbitPreferences(), view: "tree" });
mockWindows("main");
const calls: string[] = [];
let maximized = params.get("maximized") === "true";
mockIPC(command => {
  if (command === "plugin:window|is_maximized") return maximized;
  if (command === "plugin:window|toggle_maximize") {
    maximized = !maximized;
    void emit("tauri://resize", { width: innerWidth, height: innerHeight });
  }
  if (["plugin:window|minimize", "plugin:window|toggle_maximize", "plugin:window|close"].includes(command)) calls.push(command);
  return null;
}, { shouldMockEvents: true });
Object.assign(window, { ccfb2NativeCalls: calls });

const input = { goals, roster, runs, sessions, now };
const view = selectGoalViews(input), cockpit = selectCockpit(input);
const duration = (1642 * 60 + 8) * 1000;
const blocks = (busy: boolean): Block[] => [
  { id: "user", role: "user", text: busy ? "Review the window controls" : "Check the footer navigation", startedAt: Date.now() - duration, durationMs: busy ? undefined : duration },
  { id: "reason", role: "reasoning", text: "Inspect the common shell boundary." },
  ...(busy ? [] : [{ id: "answer", role: "assistant" as const, text: "The navigation check is complete." }]),
];
function evaluate(expression: string, scope: Record<string, unknown>, declarations = "") {
  return new Function(...Object.keys(scope), `${declarations}\nreturn ${expression};`)(...Object.values(scope));
}

function Fixture() {
  const [page, setPage] = useState(params.get("page") ?? "conversation");
  const teamMap = { open: page !== "conversation", scope: page };
  const close = () => setPage("conversation");
  const scope = {
    IS_MAC, compactRailActive: params.get("compact") === "true",
    searchViewOpen: false, settingsOpen: false, inboxViewOpen: false, notesViewOpen: false, automationsViewOpen: false,
    monoCovers: params.get("mono") === "true", monoSidebarOpen: true,
    monoDetailsPanel: {}, teamMap, insetLayout: false, monoOverviewOpen: false, monoOverviewPanel: null, monoViewMono: undefined,
  };
  const chromeSurfaceOpen = evaluate(expressions.chromeOpen, scope);
  const placementScope = { ...scope, chromeSurfaceOpen };
  const hideWindowControls = evaluate(expressions.hideControls, scope);
  const title = <TitleBar tabs={[]} activeId="" cwd="C:/synthetic/Atlas" standaloneTitle="Synthetic workspace"
    projectRailOpen sessionSidebarOpen hideWindowControls={hideWindowControls}
    compactRail={evaluate("compactTitleNavigation", placementScope, expressions.declarations)}
    onToggleSidebar={() => {}} onSelect={() => {}} onClose={() => {}} onCloseMany={() => {}} onReorder={() => {}} />;
  const top = evaluate(expressions.top, { ...placementScope, workspaceTitleBar: title }, expressions.declarations);
  const inner = evaluate(expressions.inner, { ...placementScope, workspaceTitleBar: title }, expressions.declarations);
  const workspaceClass = evaluate(expressions.workspaceClass, scope);
  const workspaceInert = evaluate(expressions.workspaceInert, scope);
  return <div className="flex h-screen min-w-0 flex-col bg-background-base text-content">
    {top}
    <div className="flex min-h-0 min-w-0 flex-1">
      <nav aria-label="Workspace pages" className="flex w-40 shrink-0 flex-col border-r border-stroke pt-2 max-[600px]:w-12">
        <MissionControlNav compact onOpen={() => setPage(MISSION_CONTROL_SCOPE)} />
        <UsageDashboardNav compact onOpen={() => setPage(USAGE_DASHBOARD_SCOPE)} />
        <AttentionQueueNav compact onOpen={() => setPage(ATTENTION_QUEUE_SCOPE)} />
        <TeamMapNav compact onOpen={() => setPage("map")} />
      </nav>
      <div data-page-content className="body-glass flex min-h-0 min-w-0 flex-1 flex-col">
        {page === MISSION_CONTROL_SCOPE && <MissionControlView view={view} cockpit={cockpit} onClose={close} onOpenTarget={() => {}} />}
        {page === ATTENTION_QUEUE_SCOPE && <AttentionQueueView input={input} callbacks={{}} open onClose={close} />}
        {page === USAGE_DASHBOARD_SCOPE && <div className="flex min-h-0 flex-1 flex-col overflow-auto"><button type="button" className="self-start px-6 pt-4 text-xs" onClick={close}>Back to conversation</button><UsageDashboard snapshot={{ now, groups: [], unknownAssignments: [] }} /></div>}
        {page === "map" && <TeamMap sessions={sessions} runs={runs} statuses={new Map()} onClose={close} onOpenMono={() => {}} />}
        <div data-workspace-content className={workspaceClass} aria-hidden={teamMap.open} inert={workspaceInert}>
          {inner}
          {scope.monoCovers && !IS_MAC && <aside className="flex h-10 shrink-0 justify-end" aria-label="Synthetic underlying Mono panel"><WindowControls /></aside>}
          <main className="flex min-h-0 flex-1 flex-col gap-4 py-4" data-duration-fixture>
            <section className="min-h-0 flex-1"><AgentTranscript blocks={blocks(true)} busy /></section>
            <section className="min-h-0 flex-1"><AgentTranscript blocks={blocks(false)} /></section>
          </main>
        </div>
      </div>
    </div>
  </div>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
