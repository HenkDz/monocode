import type { Mono } from "../model/mono";
import { selectAgentMetrics } from "../../agents/model/agentMetrics";
import { formatLiveElapsed } from "../../sessions/model/liveAgents";
import type { Session } from "../../sessions/model/session";
import { MemberDetails } from "./MonoTeamPage";
import { workbenchTurn } from "./WorkbenchHeader";
import { MonoPath } from "./MonoPath";

export function WorkbenchSessionDetails({
  session,
  member,
  onClose,
  onModelChange,
  onSettingsChange,
  onAccessChange,
  onSandboxChange,
}: {
  session: Session;
  member?: Mono;
  onClose: () => void;
  onModelChange: (harness: Session["harness"], model: string) => void;
  onSettingsChange: (settings: Record<string, string>, source?: Session["effortSource"]) => void;
  onAccessChange: (mode: Session["runtimeMode"], source?: Session["runtimeModeSource"]) => void;
  onSandboxChange?: (engine: Session["windowsSandbox"]) => void | Promise<void>;
}) {
  const turn = workbenchTurn(session);
  const metrics = selectAgentMetrics({
    ...session,
    blocks: turn ? [turn] : [],
  });
  const scope = !turn
    ? "No conversation turn recorded"
    : session.busy &&
        turn.durationMs == null &&
        turn.turnMetrics?.endedAt == null
      ? "Current conversation turn"
      : "Last conversation turn";
  const facts = [
    ["Timing scope", scope],
    [
      "Elapsed",
      metrics.startedAt != null && (metrics.endedAt != null || session.busy)
        ? formatLiveElapsed(metrics.startedAt, metrics.endedAt ?? Date.now())
        : turn?.durationMs != null
          ? formatLiveElapsed(0, turn.durationMs)
          : "Unavailable",
    ],
    [
      "Input tokens · including cache",
      metrics.inputTokens?.toLocaleString() ?? "Unavailable",
    ],
    [
      "Cached input · included above",
      metrics.cacheReadTokens?.toLocaleString() ?? "Unavailable",
    ],
    ["Output tokens", metrics.outputTokens?.toLocaleString() ?? "Unavailable"],
  ];
  const profile = {
    harness: session.harness,
    model: session.model,
    modelSettings: session.modelSettings,
  };
  return (
    <>
      <dl className="cc7u-facts">
        {facts.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      {metrics.partial && (
        <p className="mt-3 text-content/65">
          Recorded metrics only; some counters are unavailable.
        </p>
      )}
      <h3 className="mt-6 mb-2 font-medium">Working copy</h3>
      <MonoPath path={session.worktreeCwd ?? session.cwd} label="working copy" />
      <p className="mt-4 mb-4 text-content/65">
        Model, effort and access controls apply to the next message.
      </p>
      {member && (
        <MemberDetails
          member={member}
          fallback={profile}
          conversationProfile={profile}
          conversationEffortSource={session.effortSource}
          providerAccountId={session.providerAccountId}
          runtimeMode={session.runtimeMode}
          runtimeModeSource={session.runtimeModeSource}
          windowsSandbox={session.windowsSandbox}
          readOnly={session.readOnly}
          busy={session.busy}
          onRuntimeModeChange={onAccessChange}
          onWindowsSandboxChange={onSandboxChange}
          onBack={onClose}
          onProfileChange={(next, source) => {
            if (
              next.harness !== session.harness ||
              next.model !== session.model
            )
              onModelChange(next.harness, next.model);
            onSettingsChange(next.modelSettings ?? {}, source);
          }}
        />
      )}
    </>
  );
}
