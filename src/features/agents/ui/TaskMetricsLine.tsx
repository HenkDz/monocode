import { useEffect, useState } from "react";
import { formatLiveElapsed } from "../../sessions/model/liveAgents";
import type { AgentMetrics } from "../model/agentMetrics";
import {
  agentLiveStateLabel,
  agentLiveStateTooltip,
  type AgentLiveState,
} from "../model/agentLiveState";

export function TaskMetricsLine({
  metrics,
  state,
  startedAt = metrics?.startedAt,
  endedAt = metrics?.endedAt,
}: {
  metrics?: AgentMetrics;
  state: AgentLiveState;
  startedAt?: number;
  endedAt?: number;
}) {
  const [now, setNow] = useState(Date.now);
  const ticking = ["thinking", "running-tool", "compacting"].includes(state.status);
  useEffect(() => {
    if (!ticking || startedAt === undefined || endedAt !== undefined) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [ticking, startedAt, endedAt]);
  const input = metrics?.inputTokens;
  const output = metrics?.outputTokens;
  const counts = [
    input !== undefined && `${input.toLocaleString()} in`,
    metrics?.cacheReadTokens !== undefined && `${metrics.cacheReadTokens.toLocaleString()} cached`,
    output !== undefined && `${output.toLocaleString()} out`,
  ].filter(Boolean);
  const tokens = counts.length ? `${counts.join(" / ")} tokens` : "Tokens unavailable";
  const detail = [
    input !== undefined && `Input ${input.toLocaleString()}`,
    metrics?.cacheReadTokens !== undefined &&
      `Cached ${metrics.cacheReadTokens.toLocaleString()}`,
    output !== undefined && `Output ${output.toLocaleString()}`,
    metrics?.modelCalls !== undefined && `Model calls ${metrics.modelCalls}`,
    metrics?.compactions !== undefined && `Compactions ${metrics.compactions}`,
    metrics?.partial && "Recorded metrics only; some counters are unavailable",
    agentLiveStateTooltip(state),
  ].filter(Boolean).join(" · ");
  return (
    <p
      data-task-metrics
      title={detail}
      className="min-w-0 truncate text-[11px] tabular-nums text-content/50"
    >
      {startedAt === undefined || (!ticking && endedAt === undefined && !metrics?.elapsedMs)
        ? "Elapsed unavailable"
        : endedAt === undefined && !ticking
          ? formatLiveElapsed(0, metrics!.elapsedMs)
          : formatLiveElapsed(startedAt, endedAt ?? now)}
      {" · "}{metrics?.partial && counts.length ? "Recorded " : ""}{tokens}{" · "}{agentLiveStateLabel(state)}
    </p>
  );
}
