import { useId, useState } from "react";
import { ChevronDown } from "../../../shared/ui/icons";
import { openUrl } from "@tauri-apps/plugin-opener";
import { projectName } from "../../../shared/lib/paths";
import type { OrchestrationTask } from "../../orchestration/model/orchestrationState";
import { OrgArtifactLinks } from "../../artifacts/ui/OrgArtifactLinks";
import { AgentMarkdown } from "../../sessions/ui/AgentMarkdown";
import { TranscriptError } from "../../sessions/ui/TranscriptError";
import { presentationText } from "../../sessions/model/transcriptPresentation";

export function WorkbenchTask({ task }: { task: OrchestrationTask }) {
  const [expanded, setExpanded] = useState(false);
  const id = useId();
  const [prError, setPrError] = useState<string>();
  const cwd = task.workspace?.checkoutCwd;
  return (
    <>
      <section className="ccwb1-brief" aria-label="Task brief">
        <h3>Brief</h3>
        <div className="ccwb1-chips">
          {task.workspace?.projectCwd && (
            <span title={task.workspace.projectCwd}>
              {projectName(task.workspace.projectCwd)}
            </span>
          )}
          {task.readOnly && (
            <span title={task.readOnlyFallback}>Read-only</span>
          )}
          {!!task.checkoutBaseline?.inheritedChangedPaths?.length && (
            <span>
              {task.checkoutBaseline.inheritedChangedPaths.length} inherited
              changes
            </span>
          )}
        </div>
        <p id={id} data-expanded={expanded}>
          {presentationText(task.prompt)}
        </p>
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={id}
          onClick={() => setExpanded(!expanded)}
        >
          <span>
            {expanded ? "Show less" : "Show full brief"}
            <small>Scope, constraints and deliverables</small>
          </span>
          <ChevronDown className={`size-4 ${expanded ? "rotate-180" : ""}`} />
        </button>
      </section>
      {task.error &&
        ["failed", "blocked", "interrupted"].includes(task.status) && (
          <TranscriptError
            error={task.error}
            title={`Couldn't complete ${presentationText(task.title)}`}
          />
        )}
      {(task.result ||
        task.reportArtifactId ||
        task.reviewArtifactId ||
        task.reviewVerdict?.artifactId ||
        task.prSummaryArtifactId) && (
        <section className="ccwb1-report" aria-label="Task report">
          <h3>Report</h3>
          {["queued", "running", "cancelling"].includes(task.status) && (
            <p className="text-content/60 text-[10px]">Previous dispatch</p>
          )}
          {task.result && !task.reportArtifactId && (
            <AgentMarkdown
              className="agent-chat-bubble-md mono-run-report"
              text={presentationText(task.result)}
              streaming={false}
              cwd={cwd}
            />
          )}
          <OrgArtifactLinks
            monoId={task.memberId ?? ""}
            links={[
              { id: task.reportArtifactId, label: "Report" },
              {
                id: task.reviewArtifactId ?? task.reviewVerdict?.artifactId,
                label: "Review",
              },
              { id: task.prSummaryArtifactId, label: "PR summary" },
            ]}
          />
        </section>
      )}
      {task.prUrl && (
        <button
          type="button"
          className="cc7u-error-details"
          onClick={() => {
            setPrError(undefined);
            void openUrl(task.prUrl!).catch((error) =>
              setPrError(String(error)),
            );
          }}
        >
          Open PR
        </button>
      )}
      {prError && <p role="alert">{prError}</p>}
    </>
  );
}
