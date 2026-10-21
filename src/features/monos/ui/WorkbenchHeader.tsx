import { useEffect, useState } from "react";
import {
  agentLiveStateLabel,
  type AgentLiveState,
} from "../../agents/model/agentLiveState";
import {
  selectAgentMetrics,
  type AgentMetrics,
} from "../../agents/model/agentMetrics";
import { ArrowLeft, Folder, Square } from "../../../shared/ui/icons";
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
  currentTaskMetrics?: AgentMetrics;
  task?: boolean;
  memberName?: string;
  onHome?: () => void;
  onViewLive?: () => void;
  onStop?: () => void;
  onOpenWorktree?: () => void;
  onDetails: () => void;
};

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
  currentTaskMetrics,
  task,
  memberName,
  onHome,
  onViewLive,
  onStop,
  onOpenWorktree,
  onDetails,
}: Props) {
  const [now, setNow] = useState(Date.now);
  const turn = workbenchTurn(session);
  const live = currentTaskMetrics
    ? ["thinking", "running-tool", "compacting"].includes(state.status) &&
      currentTaskMetrics.endedAt == null
    : !!session.busy &&
      !!turn &&
      turn.durationMs == null &&
      turn.turnMetrics?.endedAt == null;
  useEffect(() => {
    if (!live || (currentTaskMetrics?.startedAt ?? turn?.startedAt) == null)
      return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [live, turn?.startedAt, currentTaskMetrics?.startedAt]);
  const metrics =
    currentTaskMetrics ??
    selectAgentMetrics(
      { ...session, busy: live, blocks: turn ? [turn] : [] },
      now,
    );
  const elapsed = currentTaskMetrics
    ? metrics.startedAt != null && live && metrics.endedAt == null
      ? formatLiveElapsed(metrics.startedAt, now)
      : metrics.turns === 0 && !metrics.partial && state.status === "idle"
        ? "Conversation not started"
        : metrics.startedAt != null || metrics.elapsedMs
          ? formatLiveElapsed(0, metrics.elapsedMs)
          : "Elapsed unavailable"
    : metrics.startedAt != null && (metrics.endedAt != null || live)
      ? formatLiveElapsed(metrics.startedAt, metrics.endedAt ?? now)
      : turn?.durationMs != null
        ? formatLiveElapsed(0, turn.durationMs)
        : "Elapsed unavailable";
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
        <div className="ccwb1-view-identity">
          <span>{task ? "Task" : "Home chat"}</span>
          {onHome && (
            <button type="button" onClick={onHome}>
              <ArrowLeft className="size-3" />
              {memberName} · Tasks & history
            </button>
          )}
        </div>
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
          title={
            turn || currentTaskMetrics
              ? taskMetricsDetail(metrics, headerState)
              : undefined
          }
        >
          {turn || currentTaskMetrics
            ? `${currentTaskMetrics ? "Current task" : `${live ? "Current" : "Last"} conversation turn`} · ${elapsed} · Usage`
            : "Choose an assignment or start a conversation"}
        </p>
      </div>
      <div className="cc7u-header-actions">
        {onViewLive && (
          <button type="button" onClick={onViewLive}>
            View live
          </button>
        )}
        {onOpenWorktree && (
          <button type="button" onClick={onOpenWorktree}>
            <Folder className="size-3" />
            Open worktree
          </button>
        )}
        {onStop && (
          <button type="button" onClick={onStop}>
            <Square className="size-3" />
            Stop
          </button>
        )}
        <button
          type="button"
          onClick={(event) => {
            event.currentTarget.focus();
            onDetails();
          }}
        >
          Details
        </button>
      </div>
    </header>
  );
}
