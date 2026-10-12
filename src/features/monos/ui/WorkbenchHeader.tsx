import { useEffect, useState } from "react";
import {
  agentLiveStateLabel,
  type AgentLiveState,
} from "../../agents/model/agentLiveState";
import { selectAgentMetrics } from "../../agents/model/agentMetrics";
import { currentTurnIndex } from "../../agents/model/turnMetrics";
import { AgentStatusLabel } from "../../agents/ui/AgentStatusLabel";
import { taskMetricsDetail } from "../../agents/ui/TaskMetricsLine";
import { PixelMascot } from "../../projects/ui/PixelMascot";
import { formatLiveElapsed } from "../../sessions/model/liveAgents";
import type { Session } from "../../sessions/model/session";

type Props = {
  session: Session;
  name: string;
  role: string;
  mascot?: string;
  color?: string;
  state: AgentLiveState;
  onMessage: () => void;
  onSteer: () => void;
  canSteer: boolean;
  onOpenWorktree?: () => void;
  onDetails: () => void;
};

const compact = new Intl.NumberFormat("en", {
  notation: "compact",
  maximumFractionDigits: 1,
});

export function workbenchTurn(session: Session) {
  const index = currentTurnIndex(session);
  return session.blocks
    .slice(Math.max(0, index))
    .reverse()
    .find(
      (block) =>
        block.role === "user" &&
        !block.draft &&
        (block.startedAt != null || block.turnMetrics) &&
        !session.queuedMessages?.some(
          (message) => message.blockId === block.id,
        ),
    );
}

export function WorkbenchHeader({
  session,
  name,
  role,
  mascot,
  color,
  state,
  onMessage,
  onSteer,
  canSteer,
  onOpenWorktree,
  onDetails,
}: Props) {
  const [now, setNow] = useState(Date.now);
  const turn = workbenchTurn(session);
  const live =
    !!session.busy &&
    !!turn &&
    turn.durationMs == null &&
    turn.turnMetrics?.endedAt == null;
  useEffect(() => {
    if (!live || turn?.startedAt == null) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [live, turn?.startedAt]);
  const metrics = selectAgentMetrics(
    { ...session, busy: live, blocks: turn ? [turn] : [] },
    now,
  );
  const elapsed =
    metrics.startedAt != null && (metrics.endedAt != null || live)
      ? formatLiveElapsed(metrics.startedAt, metrics.endedAt ?? now)
      : turn?.durationMs != null
        ? formatLiveElapsed(0, turn.durationMs)
        : "Elapsed unavailable";
  const counts =
    metrics.inputTokens == null && metrics.outputTokens == null
      ? "Tokens unavailable"
      : `${metrics.inputTokens == null ? "Input unavailable" : `${compact.format(metrics.inputTokens).toLowerCase()} in`} · ${metrics.outputTokens == null ? "Output unavailable" : `${compact.format(metrics.outputTokens).toLowerCase()} out`}`;
  const headerState =
    state.reason === "storage"
      ? {
          ...state,
          detail:
            state.status === "failed"
              ? "conversation couldn’t start"
              : "storage recovery needed",
        }
      : state;
  const label = agentLiveStateLabel(headerState);
  const detail =
    headerState.detail &&
    headerState.detail !== label &&
    label !== `Waiting · ${headerState.detail}`
      ? headerState.detail
      : undefined;

  return (
    <header data-workbench-header className="cc7u-header">
      <div className="cc7u-header-avatar">
        <PixelMascot
          name={mascot ?? "cat"}
          color={color ?? "#888"}
          still
          className="size-9 shrink-0"
        />
      </div>
      <div className="cc7u-header-identity">
        <div className="cc7u-header-name">
          <h2>{name}</h2>
          <span>{role}</span>
        </div>
        <div className="cc7u-header-state">
          <AgentStatusLabel state={headerState} />
          {detail && <span> · {detail}</span>}
        </div>
        <p
          data-workbench-metrics
          className="cc7u-header-metrics"
          title={turn ? taskMetricsDetail(metrics, headerState) : undefined}
        >
          {turn
            ? `${live ? "Current" : "Last"} conversation turn · ${elapsed} · ${counts}`
            : "No conversation turn recorded"}
        </p>
      </div>
      <div className="cc7u-header-actions">
        <button type="button" onClick={onMessage}>
          Message
        </button>
        <button type="button" onClick={onSteer} disabled={!canSteer}>
          Steer
        </button>
        <button
          type="button"
          onClick={onOpenWorktree}
          disabled={!onOpenWorktree}
        >
          Open worktree
        </button>
        <button type="button" onClick={(event) => {
          event.currentTarget.focus();
          onDetails();
        }}>
          Details
        </button>
      </div>
    </header>
  );
}
