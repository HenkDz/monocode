import { useEffect, useRef, useState } from "react";
import { basename } from "../../../platform/tauri/fs";
import { pathKey } from "../../../shared/lib/paths";
import { Popover } from "../../../shared/ui/Popover";
import { ChevronDown, FolderTree, GitBranch, Plus, Search } from "../../../shared/ui/icons";
import { useProjectBranchesState } from "../hooks/useProjectBranches";
import { useProjectWorktrees } from "../hooks/useProjectWorktrees";
import type { Worktree } from "../model/worktrees";

/** Branch choices prepare a new worktree; they never checkout a running chat. */
export function ChatWorktreePicker({
  project, path, branch, draft, enabled = true, pendingBase, onSelect, onCreate, onClose,
}: {
  project: string;
  path: string;
  branch?: string;
  draft: boolean;
  enabled?: boolean;
  pendingBase?: string;
  onSelect?: (tree: Worktree) => Promise<void>;
  onCreate?: (base: string) => void;
  onClose?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const anchor = useRef<HTMLButtonElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const option = useRef<HTMLButtonElement>(null);
  const lock = useRef(false);
  const editable = useRef(draft && enabled);
  editable.current = draft && enabled;
  const { data, error: loadError } = useProjectWorktrees(project, open);
  const { branches, settled } = useProjectBranchesState(project, open);
  const name = basename(path) || path;
  const label = pendingBase ? `new worktree from ${pendingBase}` : `${name} ${branch ?? ""}`.trim();
  const normalized = query.trim().toLocaleLowerCase();
  const trees = (data?.worktrees ?? []).filter(tree => !tree.missing && !tree.prunable);
  const rows = [
    ...trees.map(tree => ({ key: tree.path, label: basename(tree.path), branch: tree.branch ?? "detached", tree })),
    ...(branches?.branches ?? []).filter(ref => !trees.some(tree => tree.branch === ref.name))
      .map(ref => ({ key: `branch:${ref.name}`, label: ref.name, branch: "branch · new worktree", tree: undefined })),
  ].filter(row => `${row.label} ${row.branch}`.toLocaleLowerCase().includes(normalized));
  // Bound mounted rows while allowing the search to reach every ref.
  const shown = rows.slice(0, 60);
  const index = Math.min(active, Math.max(0, shown.length - 1));
  const close = () => { setOpen(false); onClose?.(); };
  useEffect(() => {
    if (!draft || !enabled) setOpen(false);
  }, [draft, enabled]);
  useEffect(() => {
    if (open) search.current?.focus();
  }, [open]);
  useEffect(() => {
    if (open) option.current?.scrollIntoView({ block: "nearest" });
  }, [open, index]);
  const pick = async (row: (typeof rows)[number]) => {
    if (!editable.current || lock.current) return;
    lock.current = true;
    setBusy(true);
    setError(undefined);
    try {
      if (row.tree) await onSelect?.(row.tree);
      else onCreate?.(row.label);
      close();
    } catch (reason) {
      setError(String(reason));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  return <>
    <button ref={anchor} type="button" aria-label={`${draft ? "Starts in" : "Working in"} ${label}`}
      title={path} aria-haspopup={draft ? "dialog" : undefined} aria-expanded={draft ? open : undefined}
      disabled={!draft || !enabled || busy} onClick={() => { setQuery(""); setActive(0); setOpen(!open); }}
      className="flex min-w-0 max-w-full items-center gap-1.5 rounded-lg border border-stroke bg-content/3 px-2 py-1 text-[11px] text-content/65 disabled:cursor-default">
      <FolderTree className="size-3.5 shrink-0" /><span className="shrink-0">{draft ? "Starts in" : "Working in"}</span>
      <span className="truncate font-medium text-content/85">{pendingBase ? "New worktree" : name}</span>
      <span className="truncate font-mono text-accent">{pendingBase ?? branch}</span>
      {draft && <ChevronDown className="size-3 shrink-0" />}
    </button>
    {open && <Popover anchor={anchor} side="top" width={340} maxHeight={380} role="dialog"
      aria-label="Starts in worktree or branch" onDismiss={close} className="flex flex-col overflow-hidden">
      <label className="flex shrink-0 items-center gap-2 border-b border-stroke p-3">
        <Search className="size-3.5 text-content/45" />
        <input ref={search} aria-label="Search worktrees or branches" placeholder="Search worktrees or branches…"
          value={query} onChange={event => { setQuery(event.target.value); setActive(0); }}
          onKeyDown={event => {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault(); setActive(Math.max(0, Math.min(shown.length - 1, index + (event.key === "ArrowDown" ? 1 : -1))));
            }
            if (event.key === "Enter" && shown[index]) { event.preventDefault(); void pick(shown[index]); }
          }} className="min-w-0 flex-1 bg-transparent text-[12px] outline-none" />
      </label>
      <div role="listbox" aria-label="Worktrees and branches" className="min-h-0 overflow-y-auto p-1.5">
        {shown.map((row, i) => <button key={row.key} ref={i === index ? option : undefined} type="button" role="option"
          aria-selected={!!row.tree && pathKey(row.tree.path) === pathKey(path)} disabled={busy}
          onMouseEnter={() => setActive(i)} onClick={() => void pick(row)}
          className={`flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-[12px] ${i === index ? "bg-selection" : "hover:bg-content/5"}`}>
          <GitBranch className="size-3.5 shrink-0 text-content/45" /><span className="min-w-0 flex-1 truncate">{row.label}</span>
          <span className="min-w-0 max-w-[45%] truncate font-mono text-[10px] text-content/45">{row.branch}</span>
          {row.tree && <span className="text-[10px] text-content/40">{pathKey(row.tree.path) === pathKey(path) ? "current" : "worktree"}</span>}
        </button>)}
        {!shown.length && <p className="p-3 text-[12px] text-content/45">{!settled ? "Loading refs…" : "No matching refs"}</p>}
      </div>
      {(error || loadError) && <p role="alert" className="p-2 text-[11px] text-red-400">{error || loadError}</p>}
      <div className="shrink-0 border-t border-stroke p-1.5">
        <button type="button" disabled={busy || !onCreate || !branches?.branches.some(ref => ref.name === "main")}
          onClick={() => { if (!editable.current || lock.current) return; onCreate?.("main"); close(); }}
          className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-[12px] text-accent hover:bg-content/5 disabled:opacity-40">
          <Plus className="size-3.5" />New worktree from main
        </button>
        <p className="px-2 py-1 text-[10px] text-content/45">{rows.length} matching refs{rows.length > shown.length ? " · type to narrow results" : ""}</p>
      </div>
    </Popover>}
  </>;
}
