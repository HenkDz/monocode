import * as React from "react";
import { createRoot } from "react-dom/client";
import { mockIPC } from "@tauri-apps/api/mocks";
// @ts-expect-error Vite source-selected production callers
import { HeaderCaller, SidebarCaller } from "virtual:ccfb5-callers";
import { RailAction, RailSearch } from "../../src/app/shell/RailAction";
import { MonoViewActions } from "../../src/app/shell/TitleBar";
import { TeamMapHeaderAction } from "../../src/features/teamMap/navigation";
import { TreeMap } from "../../src/features/teamMap/TeamMap";
import { MonoHeader } from "../../src/features/monos/ui/MonoHeader";
import { findMono, monoLook, type Mono } from "../../src/features/monos/model/mono";
import { CircleAlert, Share, FileScript, Inbox, StickyNote, Zap, CircleDashed, Search, Chatting } from "../../src/shared/ui/icons";
import "../../src/styles/index.css";

const params = new URLSearchParams(location.search);
document.documentElement.classList.toggle("theme-light", params.get("theme") === "light");
if (!sessionStorage.getItem("ccfb5-initialized")) {
  localStorage.clear();
  sessionStorage.setItem("ccfb5-initialized", "1");
}
const roster: Mono[] = [
  { id: "boss", role: "orchestrator", name: "A very long Mono name that must never collide with its header actions", projects: [], mascot: "owl", color: "#c9a7ff" },
  ...["alpha", "beta", "gamma"].map(name => ({ id: name, role: "manager" as const, reportsTo: "boss", name: `${name} Manager`, projects: [`C:/synthetic/${name}`], managerProject: `C:/synthetic/${name}`, mascot: "cat", color: "#5ed3b8" })),
  { id: "member", role: "member", name: "Member", reportsTo: "alpha", projects: ["C:/synthetic/alpha"], mascot: "cat", color: "#5ed3b8" },
];
localStorage.setItem("monocode:mono-roster", JSON.stringify(roster));
mockIPC(command => { throw Error(`Unexpected native boundary: ${command}`); });
const events: string[] = [];
Object.assign(window, { ccfb5: { events } });
const mono = findMono(params.get("mono") ?? "boss")!;
const count = Number(params.get("count") ?? 12);
const onOpenTeamMap = (scope?: string) => events.push(`map:${scope ?? "org"}`);
const ports = {
  React, RailAction, RailSearch, Share, CircleAlert, FileScript, Inbox, StickyNote, Zap, CircleDashed, Search, Chatting, MOD: "Ctrl+",
  inset: true, onSearch: undefined, railMonos: undefined, listMonos: () => roster,
  onOpenTeamMap, commandMapActive: true, onOpenAttentionQueue: () => events.push("decisions"), decisionsActive: false,
  decisionCounts: new Map([["one", Math.min(count, 1)], ["two", Math.max(0, count - 1)]]),
  onOpenIntegrations: () => {}, onOpenInbox: () => {}, inboxActive: false, inboxUnseen: false,
  notesEnabled: true, onOpenNotes: () => {}, notesActive: false, onOpenAutomations: () => {}, automationsActive: false,
  onOpenUsage: () => {}, workspaceUsage: undefined,
  TeamMapHeaderAction, MonoViewActions, monoLook, monoForSession: () => mono, session: { id: "synthetic-chat" },
  insetLayout: true, visible: true, monoViewMono: mono, monoOverviewOpen: false,
  onToggleMonoOverview: () => events.push("overview"), onOpenMonoViewSettings: () => events.push("settings"),
};
createRoot(document.getElementById("root")!).render(params.get("surface") === "map"
  ? <div style={{ height: "100vh", display: "flex" }}><TreeMap sessions={[]} runs={[]} statuses={new Map()} onOpenMono={id => events.push(`open:${id}`)} onClose={() => events.push("close")} onToggleView={() => events.push("orbit")} /></div>
  : <div className="flex min-h-screen flex-col gap-8 bg-background-base p-3 text-content">
      <aside className="w-60 rounded-xl border border-stroke p-1"><SidebarCaller {...ports} onOpenTeamMap={() => onOpenTeamMap()} /></aside>
      <main className="relative flex min-h-72 min-w-0 flex-col rounded-xl border border-stroke" aria-label="Mono pane">
        <HeaderCaller {...ports} />
        <MonoHeader agent={monoLook(mono)} state={{ status: "idle" }} />
      </main>
    </div>);
