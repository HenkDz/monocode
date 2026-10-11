import { projectName } from "../../../shared/lib/paths";
import { Chatting } from "../../../shared/ui/icons";
import {
  agentLiveStateLabel,
  agentLiveStateTooltip,
} from "../../agents/model/agentLiveState";
import { AgentStatusLabel } from "../../agents/ui/AgentStatusLabel";
import {
  sessionDisplayTitle,
  type MonoSpawnedSession,
} from "../../sessions/model/session";
import { HarnessIcon } from "../../sessions/ui/HarnessIcon";
import type { LaunchedSessionView } from "../model/monoSpawnedSessions";

/**
 * A session the Mono started, as a line under its reply like an artifact:
 * its canonical live state and the project it runs in. Without `view`
 * (a window that does not track sessions) it shows no status.
 */
export function LaunchedSessionCard({
  launch,
  view,
  open = false,
  onOpen,
}: {
  launch: MonoSpawnedSession;
  view?: LaunchedSessionView;
  /** Shown in the sidebar right now. */
  open?: boolean;
  onOpen?: () => void;
}) {
  const title = sessionDisplayTitle(
    view?.title ?? launch.title,
    launch.harness,
  );
  const status = view && agentLiveStateLabel(view.state);
  return (
    <button
      type="button"
      data-launched-session={launch.sessionId}
      data-state={view?.state.status}
      aria-label={`Open session ${title}${status ? `, ${status.toLowerCase()}` : ""}`}
      aria-pressed={open}
      title={view && agentLiveStateTooltip(view.state)}
      onClick={onOpen}
      disabled={!onOpen}
      className={`flex w-fit max-w-sm min-w-0 items-center gap-2.5 rounded-xl border py-1.5 pr-1.5 pl-3 text-left font-sans transition-colors hover:border-content/20 hover:bg-content/5 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent disabled:opacity-60 ${open ? "border-content/20 bg-content/5" : "border-content/10"}`}
    >
      {view ? (
        <AgentStatusLabel state={view.state} className="shrink-0 text-[12px]" />
      ) : (
        <Chatting
          className="size-4 shrink-0 text-content/45"
          strokeWidth={1.75}
        />
      )}
      <span className="min-w-0 truncate text-[13px] text-content">{title}</span>
      <span
        className="flex shrink-0 items-center gap-1 rounded-full border border-content/10 bg-content/5 px-2 py-0.5 text-[12px] text-content/65"
        title={launch.cwd}
      >
        <HarnessIcon harness={launch.harness} className="size-3.5" />
        {projectName(launch.cwd)}
      </span>
    </button>
  );
}
