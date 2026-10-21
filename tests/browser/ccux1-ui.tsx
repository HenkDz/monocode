import { createRoot } from "react-dom/client";
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
// @ts-expect-error source-selected App expressions from the fixture Vite plugin
import { callers } from "virtual:ccux1-page-callers";
import { TitleBar, type Tab } from "../../src/app/shell/TitleBar";
import { RailAction } from "../../src/app/shell/RailAction";
import { WorkspaceUsage } from "../../src/app/shell/WorkspaceContext";
import { UsageProviderChip } from "../../src/app/shell/UsageProviderChip";
import { Integrations } from "../../src/features/integrations/ui/Integrations";
import { APP_VIEW_LABELS, appViewTabId, SHELL_PAGE_LABELS, REUSABLE_PAGE_TAB_ID } from "../../src/features/workspace/model/appViewTabs";
import { DECISIONS_SCOPE } from "../../src/features/commandCenter/ui/Decisions";
import { INTEGRATIONS_SCOPE } from "../../src/features/integrations/model/projectIntegrations";
import { USAGE_DASHBOARD_SCOPE } from "../../src/features/providers/ui/UsageDashboard";
import { ATTENTION_QUEUE_SCOPE } from "../../src/features/commandCenter/ui/AttentionQueue";
import { MISSION_CONTROL_SCOPE } from "../../src/features/commandCenter/ui/MissionControl";
import { CircleAlert, Share } from "../../src/shared/ui/icons";
import type { UsageDashboardSnapshot } from "../../src/features/providers/model/usageDashboard";
import "../../src/styles/index.css";

const params = new URLSearchParams(location.search), now = Date.now();
document.documentElement.classList.toggle("theme-light", params.get("theme") === "light");
mockWindows("main");
const events: string[] = [];
mockIPC(command => {
  if (command === "plugin:window|is_maximized") return false;
  if (["plugin:window|minimize", "plugin:window|toggle_maximize", "plugin:window|close"].includes(command)) events.push(command);
  return null;
}, { shouldMockEvents: true });
Object.assign(window, { ccux1Events: events });
const noop = () => {};
const blank: Tab = { id: "workspace", project: "Synthetic project", title: "", more: [], sessionCount: 1, harnesses: [], busyHarnesses: [], files: [] };
const insetLayout = params.get("classic") !== "true", page = params.get("page") ?? "commandMap";
const overlay = !["inbox", "notes", "automations"].includes(page);
const teamMap = { open: overlay, scope: ({ decisions: DECISIONS_SCOPE, integrations: INTEGRATIONS_SCOPE, usage: USAGE_DASHBOARD_SCOPE } as Record<string, string>)[page] };
const evaluate = (key: string, scope: Record<string, unknown>) => new Function(...Object.keys(scope), callers[key])(...Object.values(scope));
const scope: Record<string, unknown> = { insetLayout, teamMap, DECISIONS_SCOPE, INTEGRATIONS_SCOPE, USAGE_DASHBOARD_SCOPE, ATTENTION_QUEUE_SCOPE, MISSION_CONTROL_SCOPE,
  openAppViews: ["inbox", "notes", "automations"], notesEnabled: true, APP_VIEW_LABELS, appViewTabId,
  placeholderTab: undefined, activeTabId: "workspace", shownViewTabId: overlay ? undefined : appViewTabId(page as "inbox"),
  monoCovers: params.get("mono") === "true", monoViewSession: params.get("mono") === "true" ? {} : undefined, monoViewTabId: undefined,
  monoViewMono: undefined, NO_TITLE_TABS: [], managerActive: params.get("manager") === "true", activeAppView: overlay ? undefined : page,
  settingsOpen: false, worktreeOverview: undefined, activeWorker: undefined, REUSABLE_PAGE_TAB_ID, SHELL_PAGE_LABELS,
  pageTab: overlay ? { page } : { appView: page },
};
const apps: Tab[] = evaluate("appTabs", scope);
scope.orderedTitleTabs = [blank, ...apps, ...Array.from({ length: Number(params.get("extra") ?? 0) }, (_, index) => ({ ...blank, id: `extra-${index}`, title: `Other session ${index + 1}` }))];
scope.openPage = evaluate("openPage", scope);
scope.titleTabs = evaluate("nextTitleTabs", scope);
const limits = { provider: "codex" as const, status: "ok" as const, updatedAt: now, error: null, session: null, monthly: null,
  weekly: { usedPercent: 0, windowMinutes: 10080, resetsAt: now + ((6 * 24 + 23) * 60) * 60000 } };
const snapshot = { now, groups: [{ provider: "codex", label: "Codex", accounts: [{ key: "codex:fixture", id: "fixture", label: "Fixture", freshness: "fresh", limits, assignments: [] }] }], unknownAssignments: [] } as unknown as UsageDashboardSnapshot;
createRoot(document.getElementById("root")!).render(<div className="flex h-screen min-w-0 flex-col bg-background-base text-content">
  <TitleBar tabs={evaluate("tabs", scope)} mono={evaluate("mono", scope)} standaloneTitle={evaluate("standaloneTitle", scope)} activeId={evaluate("activeId", scope)}
    cwd="C:/synthetic/project" inset={insetLayout} onToggleSidebar={noop} onSelect={noop} onClose={noop} onCloseMany={noop} onReorder={noop} onNewSession={noop} />
  <div className="flex min-h-0 flex-1">
    <aside className="w-44 shrink-0 border-r border-stroke p-2 max-[600px]:w-32">
      <RailAction label="Command map" icon={Share} onClick={noop} />
      <RailAction label="Decisions" icon={CircleAlert} badge={Number(params.get("count") ?? 0)} onClick={noop} />
      <RailAction label="Usage" icon={CircleAlert} onClick={noop} trailing={<WorkspaceUsage snapshot={snapshot} compact />} />
    </aside>
    <main className="flex min-w-0 flex-1 flex-col">
      <Integrations connected={params.get("empty") === "true" ? [] : [{ id: "github", name: "GitHub", provider: "gh CLI", scope: "Synthetic project", monos: [], available: true }]}
        requests={[]} onRequest={async () => {}} />
    </main>
  </div>
  <footer className="p-2 text-xs"><UsageProviderChip limits={limits} now={now} /></footer>
</div>);
