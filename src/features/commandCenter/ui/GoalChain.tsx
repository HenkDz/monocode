import { useId } from "react";
import { AgentStatusLabel } from "../../agents/ui/AgentStatusLabel";
import { goalElapsedLabel, type GoalTarget, type GoalView } from "../model/goalView";

export function GoalChain({ view, onOpenTarget }: { view: GoalView; onOpenTarget: (target: GoalTarget) => void }) {
  const id = useId();
  return <ol className="mc-chain" aria-label={`${view.goal.title} delegation chain`}>{view.nodes.map(node =>
    <li key={node.id} data-role={node.role} data-state={node.state?.status} className="agent-state-surface">
      <button type="button" className="mc-chain-node" disabled={!node.target} onClick={() => node.target && onOpenTarget(node.target)}
        aria-label={`Open ${node.name}`} aria-describedby={`${id}-${node.id}`} title={[node.state?.detail, node.activity, node.review && `Reviews ${node.review.taskId} / ${node.review.dispatchId}`, node.elapsedLabel].filter(Boolean).join(" · ")}>
        <span className="mc-avatar" aria-hidden="true">{node.name.slice(0, 2).toUpperCase()}</span>
        <span id={`${id}-${node.id}`} className="mc-node-copy"><strong>{node.name}</strong><small>{node.role === "orchestrator" ? "Goal origin" : node.role === "manager" ? "Delegated by Grand Orch" : node.review ? `Review of ${node.review.title}` : "Assigned by Manager"}</small>
          {node.state ? <AgentStatusLabel state={node.state} /> : <span>—</span>}</span>
        <span className="mc-elapsed" title={node.elapsedLabel}>{node.elapsedMs == null ? "—" : goalElapsedLabel(node.elapsedMs)}</span>
      </button>
    </li>)}</ol>;
}
