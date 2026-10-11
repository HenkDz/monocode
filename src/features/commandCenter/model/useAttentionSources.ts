import { useEffect, useState, useSyncExternalStore } from "react";
import { getCiRepairs, subscribeCiRepairs } from "../../inbox/model/ciRepairTracking";
import { listAutomations, peekAutomations, subscribeAutomations } from "../../automations/model/automations";

/** Share CC7D's loaded failure sources with its Cockpit host. */
export function useAttentionSources(open: boolean) {
  const repairs = useSyncExternalStore(subscribeCiRepairs, getCiRepairs);
  const [automations, setAutomations] = useState(() => peekAutomations() ?? []);
  const [sourceError, setSourceError] = useState<string>();
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const refresh = () => { void listAutomations().then(items => {
      if (!cancelled) { setAutomations(items); setSourceError(undefined); }
    }, error => { if (!cancelled) setSourceError(`Could not refresh automation failures: ${String(error)}`); }); };
    refresh();
    const stop = subscribeAutomations(refresh);
    return () => { cancelled = true; stop(); };
  }, [open]);
  return { repairs, automations, sourceError };
}
