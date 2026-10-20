import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
// @ts-expect-error source-selected production App callers
import { bindA8App } from "virtual:ccux1-a8-app";
import { WorkspaceWorktree, WorkspaceWorktrees } from "../../src/app/shell/WorkspaceContext";
import { sameProjectPath } from "../../src/features/projects/model/recents";
import { newTab, openChangesTab, type WorkspaceTab } from "../../src/features/workspace/model/layout";
import type { Worktree } from "../../src/features/source-control/model/worktrees";
import "../../src/styles/index.css";

const params = new URLSearchParams(location.search);
document.documentElement.classList.toggle("theme-light", params.get("theme") === "light");
const roots = ["C:/synthetic/browser-link-3", "C:/synthetic/browser-link-4"];
const events: { command: string; args: any }[] = [];
let clean = false;
let finishOld: (() => void) | undefined;
const tree = (path: string): Worktree => ({ path, branch: params.has("linked") && path === roots[0] ? "main" : "feature/checkout", head: "synthetic", isMain: true, locked: false, prunable: false, missing: false, dirty: false, unpushed: 0, sessionIds: [] });
const index = (cwd: string) => ({ branch: "feature/checkout", head: "synthetic", files: clean ? [] : [
  { path: `${cwd}/src/${cwd === roots[0] ? "old" : "current"}.tsx`, relative: "src/current.tsx", status: "modified", additions: 22, deletions: 8, staged: false, unstaged: true },
  { path: `${cwd}/src/new.ts`, relative: "src/new.ts", status: "added", additions: 16, deletions: 0, staged: false, unstaged: true },
  { path: `${cwd}/docs/removed.md`, relative: "docs/removed.md", status: "deleted", additions: 0, deletions: 4, staged: false, unstaged: true },
  ...(params.has("outside") ? [{ path: `${roots[0]}-other/foreign.ts`, relative: "foreign.ts", status: "modified", additions: 1, deletions: 0, staged: false, unstaged: true }] : []),
], additions: 38, deletions: 12, remote: "origin", upstream: "origin/feature/checkout", defaultBranch: "main", ahead: 2, behind: 1, aheadOfDefault: 2, headPushed: true });
mockWindows("main");
mockIPC((command, args: any) => {
  events.push({ command, args });
  if (command === "git_worktrees") return { defaultRoot: args.cwd, worktrees: params.has("linked") && args.cwd === roots[1] ? [tree(roots[0]), tree(roots[1])] : [tree(args.cwd)] };
  if (command === "git_diff_index") {
    if (params.has("delay") && args.cwd === roots[0]) return new Promise(resolve => { finishOld = () => resolve(index(args.cwd)); });
    return index(args.cwd);
  }
  if (command === "git_pr_list") return [];
  if (command === "git_pr_status") return null;
  if (command === "git_pr_create") throw Error("Captured synthetic PR command; no provider invoked.");
  if (command === "control_load") return JSON.stringify({ version: 1, goals: [], receipts: {} });
  if (command === "github_api_budget") return { status: "ok" };
  // Every unlisted boundary fails closed, including storage, providers and mutations.
  throw Error(`Blocked synthetic port: ${command}`);
});
Object.assign(window, { a8Fixture: { roots, events, clean: () => { clean = true; }, finishOld: () => finishOld?.() } });

function Fixture() {
  const [project, setProject] = useState(roots[0]);
  const [selection, select] = useState<{ project: string; path: string }>();
  const [tabs, setTabs] = useState<WorkspaceTab[]>([newTab("synthetic-session")]);
  const host = bindA8App({ React, WorkspaceWorktree, WorkspaceWorktrees, sameProjectPath, openChangesTab,
    sidebarCwd: project, contextWorktree: selection, sessions: [], setContextWorktree: select,
    setCreatingWorktreeProject: () => {}, showRightPanel: () => {}, rightPanelTab: "files", setWorkspaceContextTab: () => {},
    onSelectProjectWorktree: (_project: string, value: Worktree) => events.push({ command: "open-workspace", args: value }),
    onRemoveWorktree: async () => { throw Error("No synthetic removal authorized"); },
    closeMonoView: () => {}, setTabs, activeTabId: tabs[0].id,
    setSidebarTab: (tab: string, cwd: string) => events.push({ command: "sidebar-tab", args: { tab, cwd } }), setComposerFocused: () => {},
  });
  return <main className="mx-auto flex min-h-screen max-w-5xl flex-col bg-base text-content">
    <header className="flex flex-wrap gap-2 border-b border-stroke p-4"><strong className="mr-auto">Synthetic projects</strong>{roots.map((cwd, i) => <button className="rounded border border-stroke px-3 py-1 text-xs" key={cwd} onClick={() => setProject(cwd)}>Project {i + 1}</button>)}</header>
    <div className="flex min-h-0 flex-1 flex-col sm:flex-row"><aside className="w-full border-b border-stroke p-2 sm:w-56 sm:border-r">{host.list()}</aside><div className="min-w-0 flex-1">{host.panel()}</div></div>
    <output data-changes-target className="sr-only">{JSON.stringify(tabs)}</output>
  </main>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
