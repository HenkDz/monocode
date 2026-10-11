import { useId, useState, type ComponentProps } from "react";
import { MonoSidebar, MonoSidebarHeader } from "../../monos/ui/MonoSidebar";
import { MonoPanelTabs, type MonoPanelTab } from "../../monos/ui/monoPanelParts";
import { MonoActivityContent } from "../../monos/ui/MonoActivityPanel";
import { PullRequestsList } from "../../pullRequests/ui/PullRequestsList";
import { sessionDisplayTitle, sessionWorkCwd, type Session } from "../model/session";

export function shouldShowContextPanel({ content, explicitOpen = false, pinned = false, dismissed = false }: {
  content: boolean;
  explicitOpen?: boolean;
  pinned?: boolean;
  dismissed?: boolean;
}) {
  return explicitOpen || pinned || (!dismissed && content);
}

export function SessionRightPanel({ session, onClose, pinned = false, onPinnedChange, returnFocus, pullRequestState, onInteract }: {
  session: Session;
  onClose: () => void;
  pinned?: boolean;
  onPinnedChange?: (pinned: boolean) => void;
  returnFocus?: HTMLElement | null;
  onInteract?: () => void;
  pullRequestState?: Pick<ComponentProps<typeof PullRequestsList>, "loading" | "error" | "onRetry" | "entries">;
}) {
  const [tab, setTab] = useState<MonoPanelTab>("prs");
  const panelId = useId();
  const cwd = sessionWorkCwd(session);
  return <MonoSidebar open kind={tab} label="Session panel" color="var(--color-accent)" returnFocus={returnFocus} onInteract={onInteract}>
    <MonoSidebarHeader title={tab === "prs" ? "PRs" : tab === "details" ? "Details" : "Activity"} onClose={onClose} actions={onPinnedChange ? <button type="button" aria-label={pinned ? "Unpin session panel" : "Pin session panel"} aria-pressed={pinned} onClick={() => onPinnedChange(!pinned)} className="rounded px-1.5 py-1 text-[11px] text-content/60 hover:bg-content/8 focus-visible:outline-accent">{pinned ? "Pinned" : "Pin"}</button> : undefined}>
      <MonoPanelTabs active={tab} onChange={(next) => { onInteract?.(); setTab(next); }} panelId={panelId} />
    </MonoSidebarHeader>
    <div id={panelId} role="tabpanel" aria-labelledby={`${panelId}-${tab}`} className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      {tab === "prs" ? <PullRequestsList compact scope={{ sessionId: session.id }} scopeLabel="Related to this conversation" {...pullRequestState} />
        : tab === "activity" ? <MonoActivityContent blocks={session.blocks} live={!!session.busy} cwd={cwd} />
          : <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2 p-4 text-xs text-content/70">
            <dt>Session</dt><dd className="truncate">{sessionDisplayTitle(session.title, session.harness)}</dd>
            <dt>Worktree</dt><dd className="truncate" title={cwd}>{cwd}</dd>
            <dt>Model</dt><dd className="truncate">{session.model}</dd>
          </dl>}
    </div>
  </MonoSidebar>;
}
