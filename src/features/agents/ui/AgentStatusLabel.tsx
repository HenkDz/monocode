import { agentLiveStateLabel, agentLiveStateTooltip, type AgentLiveState } from "../model/agentLiveState";

export function AgentStatusLabel({ state, className }: { state: AgentLiveState; className?: string }) {
  return <span data-agent-state={state.status} title={agentLiveStateTooltip(state)} className={className}>{agentLiveStateLabel(state)}</span>;
}
