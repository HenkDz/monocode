import { AgentStatusLabel } from "../../agents/ui/AgentStatusLabel";
import { goalElapsedLabel, goalTokenLabel, type GoalNode, type GoalTarget, type GoalView } from "../model/goalView";

function ChainNode({ node, onOpenTarget }: { node: GoalNode; onOpenTarget: (target: GoalTarget) => void }) {
  const resolve = node.state?.status === "needs-you" || node.state?.status === "blocked" || node.state?.status === "failed";
  return <article className="mc-node" data-role={node.role} data-state={node.state?.status}>
    <div className="mc-node-role">{node.review ? "Reviewer" : node.role === "worker" ? "Worker" : node.role === "manager" ? "Manager" : "Grand Orch"}</div>
    <h3>{node.name}</h3>
    {node.state ? <AgentStatusLabel state={node.state} className="mc-state" /> : <span className="mc-state">State unavailable</span>}
    {node.state?.detail && <p className="mc-reason">{node.state.detail}</p>}
    {node.activity && node.activity !== node.state?.detail && <p className="mc-activity">{node.activity}</p>}
    <dl className="mc-node-metrics">
      <div><dt>{node.elapsedLabel}</dt><dd>{goalElapsedLabel(node.elapsedMs)}</dd></div>
      <div><dt>{node.metricsLabel ?? "Goal contribution"}</dt><dd>{goalTokenLabel(node.metrics)}</dd></div>
      {node.chatMetrics && <div><dt>Member chat goal contribution</dt><dd>{goalTokenLabel(node.chatMetrics)}</dd></div>}
    </dl>
    {node.shared && <p className="mc-note">Shared conversation · goal contribution only</p>}
    {node.review && <p className="mc-review">Review of {node.review.title}<br />
      <span>Attempt {node.review.dispatchId}{node.review.available ? "" : " · linkage unavailable"}</span></p>}
    {!!node.attempts?.length && <details className="mc-attempts">
      <summary>Attempts · {node.attempts.length}</summary>
      <ol>{node.attempts.map(attempt => <li key={attempt.edge.id}>
        <span>{attempt.edge.id} · {attempt.state.replace(/_/g, " ")}</span>
        <span>Dispatch elapsed · {goalElapsedLabel(attempt.elapsedMs)}</span>
      </li>)}</ol>
    </details>}
    {node.target ? <button type="button" className="mc-link" onClick={() => onOpenTarget(node.target!)}
      aria-label={`${resolve ? "Resolve" : "Message / steer"} ${node.name}`}>
      {resolve ? "Resolve" : "Message / steer"}<span aria-hidden="true"> →</span>
    </button> : <p className="mc-note">Conversation unavailable</p>}
  </article>;
}

export function GoalChain({ view, onOpenTarget }: { view: GoalView; onOpenTarget: (target: GoalTarget) => void }) {
  const leaders = view.nodes.filter(node => node.role !== "worker");
  const workers = view.nodes.filter(node => node.role === "worker");
  return <ol className="mc-chain" aria-label={`${view.goal.title} delegation chain`}>
    {leaders.map(node => <li key={node.id}><ChainNode node={node} onOpenTarget={onOpenTarget} /></li>)}
    <li className="mc-worker-branch">
      {workers.length ? <ol aria-label="Worker assignments">{workers.map(node => <li key={node.id}>
        <ChainNode node={node} onOpenTarget={onOpenTarget} />
      </li>)}</ol> : <p className="mc-empty-workers">No linked worker assignments yet.</p>}
    </li>
  </ol>;
}
