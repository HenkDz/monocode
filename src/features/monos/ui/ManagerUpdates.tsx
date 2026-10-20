import { useState } from "react";
import { Modal } from "../../../shared/ui/Modal";
import { ArtifactText } from "../../artifacts/ui/ArtifactReference";
import type { ManagerWakeEvent } from "../../orchestration/model/managerWake";
import { AttentionDetails } from "../../commandCenter/ui/AttentionDetails";
import "../../commandCenter/ui/attentionQueue.css";

export function ManagerUpdates({ events, monoId, label = "Has an update for you" }: { events: readonly ManagerWakeEvent[]; monoId: string; label?: string }) {
  const [open, setOpen] = useState(false);
  if (!events.length) return <>{label}</>;
  return <><button type="button" className="rounded text-left underline decoration-content/30 underline-offset-4 focus-visible:outline-accent" aria-haspopup="dialog" onClick={() => setOpen(true)}>{label}</button>
    {open && <Modal title="Manager updates" onClose={() => setOpen(false)}>
      <ol className="max-h-[65vh] space-y-4 overflow-y-auto p-5 text-sm">
        {events.map(event => <li key={event.id} className="break-words rounded-lg border border-stroke p-3">
          <p>{event.kind === "question" ? "A teammate has a question" : event.kind === "failure" ? "A task needs the Manager's attention" : "A teammate shared an update"}</p>
          <AttentionDetails title="Show work"><p className="text-xs text-content/50">{event.id}</p><div className="whitespace-pre-wrap"><ArtifactText text={event.text} monoId={monoId} /></div></AttentionDetails>
        </li>)}
      </ol>
    </Modal>}
  </>;
}
