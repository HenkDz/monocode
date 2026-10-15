import { useEffect, useRef } from "react";
import { remoteProjectFor } from "../../features/connections/model/remoteProjects";
import { canAutomaticallyRepairCodexStorage } from "../../features/monos/model/monoCodexStorage";
import type { Session } from "../../features/sessions/model/session";

export function useCodexStorageLockRecovery(sessions: Session[], repair: (sessionId: string, resolution: undefined, automatic: true) => Promise<void>) {
  const latest = useRef({ sessions, repair });
  latest.current = { sessions, repair };
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const check = async () => {
      for (const session of latest.current.sessions) {
        if (stopped) return;
        const current = latest.current.sessions.find(entry => entry.id === session.id);
        if (current && canAutomaticallyRepairCodexStorage(current) && !remoteProjectFor(current.cwd)) {
          // One readiness attempt at a time; a refusal retains the existing held turn/queue.
          await latest.current.repair(current.id, undefined, true).catch(() => {});
        }
      }
      if (!stopped) timer = setTimeout(check, 5000);
    };
    timer = setTimeout(check, 5000);
    return () => { stopped = true; clearTimeout(timer); };
  }, []);
}
