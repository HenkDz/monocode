import { useState, useSyncExternalStore } from "react";
import { findMono, listMonos, monoLook, monosSnapshot, subscribeMonos } from "../model/mono";
import { reviewerModelWarning, undoMonoTeamChanges } from "../model/monoTeam";
import { monoTeamHost } from "../model/monoTeamRuntime";
import { PixelMascot } from "../../projects/ui/PixelMascot";
import { OrgArtifactLinks } from "../../artifacts/ui/OrgArtifactLinks";

const plainSoul = (text: string) => text.replace(/^\s*#{1,6}\s+.*$/gm, "").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/[`*_]/g, "").replace(/^\s*(?:>|[-+])\s*/gm, "").replace(/\s+/g, " ").trim();

export function MonoTeamChangeCard({ managerId, changeId, changeIds }: { managerId: string; changeId: string; changeIds?: string[] }) {
  useSyncExternalStore(subscribeMonos, monosSnapshot);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const manager = listMonos(true).find(mono => mono.id === managerId);
  const receipts = manager?.teamChanges ?? [];
  const changes = (changeIds ?? [changeId]).flatMap(id => receipts.find(change => change.id === id) ?? []);
  if (!changes.length) return null;
  const title = changes.every(change => change.action === "team.hire") ? "Team hired" : "Team updated";
  const rows = [...new Map(changes.map(change => [change.memberId, change])).values()];
  const undone = changes.every(change => change.undoneAt);
  const button = "rounded-md px-2.5 py-1.5 hover:bg-content/8 focus-visible:outline-accent disabled:opacity-40";
  return <section aria-label={title} className="min-w-0 overflow-hidden rounded-xl border border-content/20 bg-content/5 p-3 font-sans text-xs shadow-sm">
    <div className="flex items-center justify-between gap-3">
      <h3 className="text-sm font-medium">{title}</h3>
      <button type="button" disabled={busy || undone || changes.some(change => change.state !== "applied")} className={button} onClick={async () => {
        setBusy(true);
        try { await undoMonoTeamChanges(managerId, changes.map(change => change.id), await monoTeamHost(managerId)); setError(undefined); }
        catch (error) { setError(String(error)); }
        finally { setBusy(false); }
      }}>{undone ? "Undone" : busy ? "Undoing…" : "Undo"}</button>
    </div>
    <OrgArtifactLinks monoId={managerId} links={[{ id: manager?.teamPlanArtifactId, label: "Team plan" }]} />
    {rows.map(change => {
      const member = findMono(change.memberId) ?? change.after ?? change.before;
      const look = monoLook(member);
      const memberChanges = changes.filter(receipt => receipt.memberId === change.memberId);
      const soul = plainSoul([...memberChanges].reverse().find(receipt => receipt.files?.soul)?.files?.soul?.after ?? member.instructions ?? "");
      const summary = soul.match(/^.*?[.!?](?=\s|$)/)?.[0] ?? soul;
      const warning = reviewerModelWarning(member, listMonos()) ?? memberChanges.find(receipt => receipt.warning)?.warning;
      return <div key={change.id} data-team-member={change.memberId} className="mt-2 flex min-w-0 items-start gap-3 border-t border-content/10 pt-3">
        <PixelMascot name={look.mascot} color={look.color} still className="size-8 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <strong className="truncate text-sm font-medium">{look.name}</strong>
            <span className="rounded-md bg-content/5 px-1.5 py-0.5 text-content/60">{member.specialty ?? "Member"}</span>
            {member.workerProfile && <span title={member.workerProfile.harness} className="rounded-md bg-content/5 px-1.5 py-0.5 text-content/60">{member.workerProfile.model}</span>}
            {change.action === "team.retire" && <span className="text-content/50">Retired</span>}
          </div>
          {summary && <p className="mt-1 truncate text-content/60" title={summary}>{summary}</p>}
          {soul.length > summary.length && <details className="mt-1 text-content/60"><summary className="w-fit cursor-pointer rounded focus-visible:outline-accent">Soul</summary><p className="mt-2 whitespace-pre-wrap break-words">{soul}</p></details>}
          {change.action !== "team.hire" && <p className="mt-1 text-content/60">{change.summary}</p>}
          {warning && <p className="mt-1 text-amber-700 dark:text-amber-400">{warning}</p>}
          {change.error && <p role="alert" className="mt-1 text-red-700 dark:text-red-400">{change.error}</p>}
        </div>
        {findMono(change.memberId) && <button type="button" className={button} onClick={() => window.dispatchEvent(new CustomEvent("monocode:open-team", { detail: { monoId: change.memberId } }))}>Edit</button>}
      </div>;
    })}
    {error && <p role="alert" className="mt-2 text-red-700 dark:text-red-400">{error}</p>}
  </section>;
}
