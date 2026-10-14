import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { GoalViewInput } from "../../commandCenter/model/goalView";
import { providerAccounts, subscribeProviderAccounts } from "./providerAccounts";
import { getAllRateLimits, loadRateLimits, subscribeRateLimits } from "./rateLimitsCache";
import { fetchPiUsage, piUsageProvider, type PiUsageProvider } from "./piUsage";
import { RATE_LIMIT_MIN_REFETCH_MS, RATE_LIMIT_POLL_MS, type ProviderRateLimits } from "./rateLimits";
import { selectUsageDashboard } from "./usageDashboard";
import { collectUsageHistory, readUsageHistory, USAGE_HISTORY_KEY, type UsageHistory } from "./usageHistory";

/** Mount once above Dashboard and Mission control so both consume one clock and snapshot. */
export function useUsageDashboard(input: Pick<GoalViewInput, "roster" | "runs" | "sessions">) {
  const accountJSON = useSyncExternalStore(subscribeProviderAccounts,
    () => JSON.stringify([ ...providerAccounts("codex"), ...providerAccounts("claude") ]));
  const accounts = useMemo(() => JSON.parse(accountJSON) as ReturnType<typeof providerAccounts>, [accountJSON]);
  const usage = useSyncExternalStore(subscribeRateLimits, getAllRateLimits);
  const [pi, setPi] = useState<Record<string, ProviderRateLimits>>({});
  const [now, setNow] = useState(Date.now);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [history, setHistory] = useState<UsageHistory>({});
  const [historyWarning, setHistoryWarning] = useState<string>();
  const piKey = [...new Set(input.sessions.filter(session => session.harness === "pi").flatMap(session => piUsageProvider(session.model) ?? []))].sort().join(",");
  useEffect(() => {
    let disposed = false;
    let running = false;
    let lastFetch = 0;
    const refresh = async () => {
      if (running || disposed || document.visibilityState === "hidden" || Date.now() - lastFetch < RATE_LIMIT_MIN_REFETCH_MS) return;
      running = true;
      lastFetch = Date.now();
      const results = await Promise.allSettled([
        ...accounts.map(account => loadRateLimits(account.provider, account.id, true)),
        loadRateLimits("opencode", "default", true),
        ...piKey.split(",").filter(Boolean).map(async provider => {
          const result = await fetchPiUsage(provider as PiUsageProvider);
          if (!disposed) setPi(previous => ({ ...previous, [`pi:${provider}`]: result }));
        }),
      ]);
      if (!disposed) {
        if (results.some(result => result.status === "rejected")) setHistoryWarning("Some usage readers failed. Refresh to try again.");
        setNow(Date.now());
      }
      running = false;
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), RATE_LIMIT_POLL_MS);
    const clock = window.setInterval(() => setNow(Date.now()), 30_000);
    const visible = () => void refresh();
    document.addEventListener("visibilitychange", visible);
    window.addEventListener("focus", visible);
    return () => { disposed = true; window.clearInterval(timer); window.clearInterval(clock); document.removeEventListener("visibilitychange", visible); window.removeEventListener("focus", visible); };
  }, [accounts, piKey, refreshVersion]);
  const snapshot = useMemo(() => selectUsageDashboard({ ...input, accounts, usage: { ...usage, ...pi }, now }), [input.roster, input.runs, input.sessions, accounts, usage, pi, now]);
  useEffect(() => {
    let storage: Storage;
    try { storage = localStorage; }
    catch { setHistoryWarning("Local trend history is unavailable."); return; }
    const loaded = readUsageHistory(storage, snapshot.now);
    const next = collectUsageHistory(loaded.history, snapshot);
    setHistory(next);
    if (!loaded.writable) { setHistoryWarning("Local trend history is unavailable; stored data was preserved."); return; }
    if (next === loaded.history) return;
    try { storage.setItem(USAGE_HISTORY_KEY, JSON.stringify(next)); }
    catch { setHistoryWarning("Local trend history could not be saved."); }
  }, [snapshot]);
  return { snapshot, history, historyWarning, refresh: useCallback(() => setRefreshVersion(version => version + 1), []) };
}
