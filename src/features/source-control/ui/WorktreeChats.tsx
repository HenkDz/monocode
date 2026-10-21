import { useEffect, useState, useSyncExternalStore } from "react";
import { basename } from "../../../platform/tauri/fs";
import { isEqualOrInside, pathKey } from "../../../shared/lib/paths";
import { Plus } from "../../../shared/ui/icons";
import { useProjectWorktrees } from "../hooks/useProjectWorktrees";
import { usePrStatus } from "../hooks/usePrStatus";
import { worktreeSessionGroups } from "../model/worktreeSessions";
import { chatWorktreePath } from "../model/chatWorktree";
import type { Worktree } from "../model/worktrees";
import type { SessionSummary } from "../../sessions/data/sessionStore";
import { sessionDisplayTitle, type Session } from "../../sessions/model/session";
import { selectAgentLiveState, agentLiveStateLabel } from "../../agents/model/agentLiveState";
import { currentTurnIndex } from "../../agents/model/turnMetrics";
import { orchestrator } from "../../orchestration/model/orchestration";

export function WorktreeChats({ project, selectedPath, sessions, history, openSessions, activeId, unseen, onSelect, onChat, onNew, onCreate }: {
  project: string; selectedPath: string; sessions: readonly Session[]; history: readonly SessionSummary[];
  openSessions: readonly SessionSummary[]; activeId?: string; unseen: ReadonlySet<string>;
  onSelect: (tree: Worktree) => void; onChat: (id: string) => void;
  onNew: (tree: Worktree) => void; onCreate: () => void;
}) {
  const { data, error } = useProjectWorktrees(project, !project.startsWith("remote:"));
  const runs = useSyncExternalStore(orchestrator.subscribe, orchestrator.snapshot);
  const [now, setNow] = useState(Date.now);
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(timer); }, []);
  const trees = data?.worktrees.filter(tree => !tree.missing && !tree.prunable) ?? [];
  const groups = worktreeSessionGroups(project, trees, history, openSessions, runs);
  const selected = chatWorktreePath(project, selectedPath, data?.worktrees);
  return <section aria-label="Worktrees" className="px-2 pb-3">
    <div className="flex items-center px-2 pb-1 pt-3 text-[10px] font-medium uppercase tracking-wider text-content/45">
      <h2 className="flex-1">Worktrees</h2><button type="button" aria-label="New worktree" onClick={onCreate} className="grid size-6 place-items-center rounded hover:bg-content/5"><Plus className="size-3.5" /></button>
    </div>
    {trees.map(tree => <WorktreeChatGroup key={tree.path} tree={tree} rows={groups.get(pathKey(tree.path)) ?? []} trees={trees}
      selected={pathKey(tree.path) === pathKey(selected)} sessions={sessions} activeId={activeId} unseen={unseen} now={now}
      onSelect={() => onSelect(tree)} onChat={onChat} onNew={() => onNew(tree)} />)}
    {!trees.length && <p className="px-2 py-3 text-[11px] text-content/45">{error ? "Worktrees unavailable" : data ? "No worktrees yet" : "Loading worktrees…"}</p>}
  </section>;
}

function WorktreeChatGroup({ tree, trees, rows, selected, sessions, activeId, unseen, now, onSelect, onChat, onNew }: {
  tree: Worktree; rows: readonly SessionSummary[]; selected: boolean; sessions: readonly Session[]; activeId?: string;
  trees: readonly Worktree[];
  unseen: ReadonlySet<string>; now: number; onSelect: () => void; onChat: (id: string) => void; onNew: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const { pr } = usePrStatus(tree.path, tree.branch, true);
  const items = rows.map(row => {
    const session = sessions.find(session => session.id === row.id);
    const state = session ? selectAgentLiveState(session) : undefined;
    const working = !!state && ["thinking", "running-tool", "compacting"].includes(state.status);
    const attention = !!state && ["needs-you", "blocked", "failed", "waiting-review"].includes(state.status);
    const settled = !working && !attention && !unseen.has(row.id) && !row.draft;
    const turn = session ? session.blocks[currentTurnIndex(session)] : undefined;
    const elapsed = turn?.startedAt ? Math.max(0, Math.floor((now - turn.startedAt) / 60_000)) : undefined;
    const label = working ? `Working${elapsed == null ? "" : ` · ${elapsed}m`}`
      : state?.status === "done" || unseen.has(row.id) ? "Answered"
      : settled ? "Settled" : state?.status === "idle" || !state ? (row.draft ? "Draft" : "Ready for you") : agentLiveStateLabel(state);
    const removed = row.worktreeRemoved || !!row.worktreeCwd && !trees.some(tree => isEqualOrInside(row.worktreeCwd!, tree.path));
    return { row, settled, working, attention, label, removed };
  });
  const settled = items.filter(item => item.settled);
  const renderChat = ({ row, label, working, removed }: (typeof items)[number]) => <button key={row.id} type="button"
    aria-current={row.id === activeId ? "true" : undefined} onClick={() => onChat(row.id)}
    className={`grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 rounded-lg px-2 py-1.5 text-left hover:bg-content/5 ${row.id === activeId ? "bg-selection" : ""}`}>
    <span className="truncate text-[11px] text-content/80">{sessionDisplayTitle(row.title, row.harness)}</span>
    <time dateTime={new Date(row.updatedAt).toISOString()} className="row-span-2 text-[10px] text-content/35">{Math.max(0, Math.floor((now - row.updatedAt) / 60_000)) < 60 ? `${Math.max(0, Math.floor((now - row.updatedAt) / 60_000))}m` : new Date(row.updatedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</time>
    <span className={`truncate text-[10px] ${working ? "text-accent" : "text-content/40"}`}>{label}{removed ? " · worktree removed" : ""}</span>
  </button>;
  return <div className={`mb-1 rounded-xl ${selected ? "border border-accent/20 bg-content/3" : "border border-transparent"}`}>
    <button type="button" aria-current={selected ? "true" : undefined} aria-label={`Worktree ${tree.branch ?? basename(tree.path)}`}
      onClick={onSelect} className="flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left hover:bg-content/5">
      <span aria-label={items.some(item => item.attention) ? "Needs your attention" : items.some(item => item.working) ? "Working" : "Idle"}
        className={`size-2 shrink-0 rounded-full ${items.some(item => item.attention) ? "bg-amber-400" : items.some(item => item.working) ? "bg-accent" : "bg-content/25"}`} />
      <span className="min-w-0 flex-1"><span className="block truncate text-[12px] font-medium">{basename(tree.path)}</span><span className="block truncate font-mono text-[10px] text-content/40">{tree.branch ?? "detached"}</span></span>
      {!selected && <span className="text-[10px] text-content/40">{rows.length}</span>}
      {pr && <span className="rounded-md bg-emerald-400/10 px-1.5 py-0.5 text-[10px] text-emerald-500">#{pr.number}</span>}
    </button>
    {selected && <div className="pb-1.5 pl-6 pr-1.5">
      {items.filter(item => !item.settled).map(renderChat)}
      {!!settled.length && <button type="button" aria-expanded={expanded} onClick={() => setExpanded(!expanded)} className="flex w-full items-center gap-1 rounded-lg px-2 py-1 text-[10px] text-content/45 hover:bg-content/5">{expanded ? "Hide" : "Show"} {settled.length} settled</button>}
      {settled.filter(item => expanded || item.row.id === activeId).map(renderChat)}
      <button type="button" onClick={onNew} className="flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-[11px] text-accent hover:bg-content/5"><Plus className="size-3" />New chat here</button>
    </div>}
  </div>;
}
