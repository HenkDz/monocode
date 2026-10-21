import { useId, useState } from "react";
import { activityTaskTitle } from "../../monos/model/monoTeamActivity";
import type { OrchestrationTask } from "../../orchestration/model/orchestrationState";
import { OrgArtifactLinks } from "../../artifacts/ui/OrgArtifactLinks";
import { ShortHashes } from "../../../shared/ui/ShortHashes";

export function GoalTaskSummary({ task, goalTitle }: { task: OrchestrationTask; goalTitle?: string }) {
  const [open, setOpen] = useState(false), [notice, setNotice] = useState("");
  const id = useId();
  const work = [task.prompt, `Task: ${task.id}`, task.activeDispatchId ?? task.lastDispatchId,
    task.checkoutBaseline?.head, task.checkoutBaseline?.fingerprint, task.reportArtifactId, task.reviewArtifactId, task.prSummaryArtifactId, task.result].filter(Boolean).join("\n\n");
  return <div>
    <p className="truncate" data-task-summary>{activityTaskTitle(task, goalTitle)}</p>
    <button type="button" className="mt-1 rounded py-1 text-[11px] text-content/60 hover:text-content focus-visible:outline-accent" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
      <span aria-hidden="true">{open ? "−" : "+"}</span> Show work
    </button>
    {open && <div id={id} className="mt-2 rounded-lg border border-stroke bg-content/3 p-3">
      <pre className="whitespace-pre-wrap break-words text-[11px] leading-relaxed"><ShortHashes text={work} /></pre>
      <OrgArtifactLinks monoId={task.memberId ?? ""} links={[{ id: task.reportArtifactId, label: "Report" }, { id: task.reviewArtifactId ?? task.reviewVerdict?.artifactId, label: "Review" }, { id: task.prSummaryArtifactId, label: "PR summary" }]} />
      <button type="button" className="mt-2 rounded text-[11px] text-content/60 hover:text-content focus-visible:outline-accent" onClick={() => {
        void Promise.resolve().then(() => navigator.clipboard.writeText(work)).then(() => setNotice("Copied"), () => setNotice("Couldn't copy. Select the text to copy it."));
      }}>Copy work</button>
      {notice && <p role="status" className="mt-1 text-[11px] text-content/60">{notice}</p>}
    </div>}
  </div>;
}
