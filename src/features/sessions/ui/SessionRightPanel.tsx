import { useId, useState } from "react";
import { MonoSidebar, MonoSidebarHeader } from "../../monos/ui/MonoSidebar";
import { MonoPanelTabs, type MonoPanelTab } from "../../monos/ui/monoPanelParts";
import { MonoActivityContent } from "../../monos/ui/MonoActivityPanel";
import { PullRequestsList } from "../../pullRequests/ui/PullRequestsList";
import { sessionDisplayTitle, sessionWorkCwd, type Session } from "../model/session";

export function SessionRightPanel({ session, onClose }: { session: Session; onClose: () => void }) {
  const [tab, setTab] = useState<MonoPanelTab>("prs");
  const panelId = useId();
  const cwd = sessionWorkCwd(session);
  return <MonoSidebar open kind={tab} label="Session panel" color="var(--color-accent)">
    <MonoSidebarHeader title={tab === "prs" ? "PRs" : tab === "details" ? "Details" : "Activity"} onClose={onClose}>
      <MonoPanelTabs active={tab} onChange={setTab} panelId={panelId} />
    </MonoSidebarHeader>
    <div id={panelId} role="tabpanel" aria-labelledby={`${panelId}-${tab}`} className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      {tab === "prs" ? <PullRequestsList compact scope={{ sessionId: session.id }} />
        : tab === "activity" ? <MonoActivityContent blocks={session.blocks} live={!!session.busy} cwd={cwd} />
          : <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2 p-4 text-xs text-content/70">
            <dt>Session</dt><dd className="truncate">{sessionDisplayTitle(session.title, session.harness)}</dd>
            <dt>Worktree</dt><dd className="truncate" title={cwd}>{cwd}</dd>
            <dt>Model</dt><dd className="truncate">{session.model}</dd>
          </dl>}
    </div>
  </MonoSidebar>;
}
