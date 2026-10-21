import { useEffect, useState } from "react";
import { revealPath } from "../../../platform/tauri/fs";
import { Folder, Terminal } from "../../../shared/ui/icons";
import { packageScripts, type PackageScript } from "../../projects/model/packageScripts";

export function WorktreeQuickActions({ project, path, unavailable, onRun }: {
  project: string; path: string; unavailable: boolean; onRun: (project: string, path: string, name: string) => Promise<void>;
}) {
  const [scripts, setScripts] = useState<PackageScript[]>([]);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let current = true;
    setScripts([]); setError(undefined); setOpen(false);
    if (!unavailable) void packageScripts(path).then(value => { if (current) setScripts(value); }, () => { /* Projects without package.json have no npm scripts. */ });
    return () => { current = false; };
  }, [project, path, unavailable]);
  const run = async (name: string) => {
    if (busy || unavailable) return;
    setBusy(true); setError(undefined); setOpen(false);
    try { await onRun(project, path, name); } catch (reason) { setError(String(reason)); } finally { setBusy(false); }
  };
  return <div aria-label="Worktree quick actions" className="mb-4 space-y-0.5 border-b border-stroke pb-3">
    <button type="button" disabled={unavailable} onClick={() => { void revealPath(path).catch(reason => setError(String(reason))); }}
      className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12px] text-content/65 hover:bg-content/5 disabled:opacity-40"><Folder className="size-3.5" />Open in File Explorer</button>
    {!!scripts.length && <button type="button" aria-expanded={open} disabled={busy || unavailable} onClick={() => setOpen(!open)} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12px] text-content/75 hover:bg-content/5"><Terminal className="size-3.5" />Run {open ? "−" : "+"}</button>}
    {open && [...scripts].sort((a, b) => Number(!["dev", "start", "test"].includes(a.name)) - Number(!["dev", "start", "test"].includes(b.name))).map(script => <button key={script.name} type="button" disabled={busy || unavailable} onClick={() => void run(script.name)}
      title={script.command} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12px] text-content/65 hover:bg-content/5 disabled:opacity-40">
      <Terminal className="size-3.5 shrink-0" /><span className="min-w-0 flex-1 truncate">{script.name === "dev" || script.name === "start" ? "Run app" : script.name === "test" ? "Run tests" : script.name}</span>
      <span className="max-w-[50%] truncate font-mono text-[10px] text-content/35">{script.run}</span>
    </button>)}
    {error && <p role="alert" className="px-2 text-[11px] text-red-400">{error}</p>}
  </div>;
}
