import { useState, useSyncExternalStore } from "react";
import { findMono, monoLook, monosSnapshot, subscribeMonos } from "../model/mono";
import { undoMonoTeamChange } from "../model/monoTeam";
import { monoTeamHost } from "../model/monoTeamRuntime";
import { PixelMascot } from "../../projects/ui/PixelMascot";

export function MonoTeamChangeCard({ managerId, changeId }: { managerId: string; changeId: string }) {
  useSyncExternalStore(subscribeMonos, monosSnapshot);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const change = findMono(managerId)?.teamChanges?.find(change => change.id === changeId);
  if (!change) return null;
  const member = findMono(change.memberId) ?? change.after ?? change.before;
  const look = member && monoLook(member);
  return <section aria-label={change.action === "team.hire" ? "Team hired" : "Team changed"} className="rounded-xl border border-stroke p-3 text-xs">
    <h3 className="font-medium">{change.state === "failed" ? "Team change stopped" : change.action === "team.hire" ? "Team hired" : "Team changed"}</h3>
    <div className="mt-2 flex items-center gap-2">
      {look && <PixelMascot name={look.mascot} color={look.color} still className="size-7" />}
      <div className="min-w-0 flex-1">
        <p>{look?.name ?? change.memberName} · {member?.specialty} · {member?.workerProfile?.model}</p>
        <p className="mt-1 text-content/60">{change.summary}</p>
        {change.action === "team.hire" && change.files?.soul && <p className="mt-1 truncate text-content/60">{change.files.soul.after.replace(/\s+/g, " ")}</p>}
      </div>
      {findMono(change.memberId) && <button type="button" className="rounded px-2 py-1 hover:bg-content/10" onClick={() => window.dispatchEvent(new CustomEvent("monocode:open-team", { detail: { monoId: change.memberId } }))}>Edit</button>}
      <button type="button" disabled={busy || !!change.undoneAt || change.state !== "applied"} className="rounded px-2 py-1 hover:bg-content/10 disabled:opacity-50" onClick={async () => {
        setBusy(true);
        try { await undoMonoTeamChange(managerId, changeId, await monoTeamHost(managerId)); setError(undefined); }
        catch (error) { setError(String(error)); }
        finally { setBusy(false); }
      }}>{change.undoneAt ? "Undone" : "Undo"}</button>
    </div>
    {change.error && <p role="alert" className="mt-2 text-red-500">{change.error}</p>}
    {error && <p role="alert" className="mt-2 text-red-500">{error}</p>}
  </section>;
}
