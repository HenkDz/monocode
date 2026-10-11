import {
  agentLiveStateLabel,
  agentLiveStateTooltip,
  type AgentLiveState,
} from "../model/agentLiveState";
import { Check } from "../../../shared/ui/icons";
import "./agentState.css";

export type AgentStatusLabelProps = {
  state: AgentLiveState;
  className?: string;
};

export function AgentStatusLabel({ state, className }: AgentStatusLabelProps) {
  return (
    <span
      data-agent-state={state.status}
      title={agentLiveStateTooltip(state)}
      className={`agent-state ${className ?? ""}`}
    >
      {state.status === "done" ? (
        <Check
          aria-hidden="true"
          className="agent-state-cue agent-state-check"
          strokeWidth={2}
        />
      ) : (
        <span aria-hidden="true" className="agent-state-cue" />
      )}
      <span className="agent-state-text">{agentLiveStateLabel(state)}</span>
    </span>
  );
}
