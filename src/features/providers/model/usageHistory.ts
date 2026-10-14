import type { UsageAccount, UsageDashboardSnapshot } from "./usageDashboard";

export const USAGE_HISTORY_KEY = "monocode.usageHistory.v1";
export const HISTORY_MIN_SAMPLES = 3;
export const HISTORY_INTERVAL_MS = 60_000;
export const HISTORY_MAX_AGE_MS = 7 * 86_400_000;
export const HISTORY_MAX_KEYS = 128;
export const HISTORY_MAX_SAMPLES = 96;
export type UsageHistorySample = { at: number; remaining: number; resetAt: number; windowMinutes: number };
export type UsageHistory = Record<string, UsageHistorySample[]>;
const windows = ["session", "weekly"] as const;
const keyFor = (account: UsageAccount, window: typeof windows[number]) => JSON.stringify([account.provider, account.accountId, window]);

function valid(sample: UsageHistorySample, now: number): boolean {
  return !!sample && Number.isSafeInteger(sample.at) && sample.at > 0 && sample.at <= now && now - sample.at <= HISTORY_MAX_AGE_MS &&
    Number.isFinite(sample.remaining) && sample.remaining >= 0 && sample.remaining <= 100 &&
    Number.isSafeInteger(sample.resetAt) && sample.resetAt > sample.at && Number.isSafeInteger(sample.windowMinutes) && sample.windowMinutes > 0;
}

/** Persist normalized numbers only; malformed or oversized data stays untouched on disk. */
export function readUsageHistory(storage: Pick<Storage, "getItem">, now: number): { history: UsageHistory; writable: boolean } {
  try {
    const raw = storage.getItem(USAGE_HISTORY_KEY);
    if (!raw) return { history: {}, writable: true };
    if (raw.length > 2_000_000) return { history: {}, writable: false };
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { history: {}, writable: false };
    const entries = Object.entries(parsed);
    if (entries.length > HISTORY_MAX_KEYS) return { history: {}, writable: false };
    const history: UsageHistory = {};
    for (const [key, samples] of entries) {
      const identity: unknown = JSON.parse(key);
      if (!Array.isArray(identity) || identity.length !== 3 || !["codex", "claude", "opencode", "pi"].includes(identity[0]) || typeof identity[1] !== "string" || identity[1].length > 100 || !windows.includes(identity[2]) || !Array.isArray(samples) || samples.length > HISTORY_MAX_SAMPLES) return { history: {}, writable: false };
      if (samples.some(sample => !sample || typeof sample !== "object" || !Number.isSafeInteger(sample.at) || !Number.isFinite(sample.remaining) || sample.remaining < 0 || sample.remaining > 100 || !Number.isSafeInteger(sample.resetAt) || sample.resetAt <= sample.at || !Number.isSafeInteger(sample.windowMinutes) || sample.windowMinutes <= 0)) return { history: {}, writable: false };
      const recent = (samples as UsageHistorySample[]).filter(sample => valid(sample, now)).sort((a, b) => a.at - b.at);
      if (recent.length) history[key] = recent.map(({ at, remaining, resetAt, windowMinutes }) => ({ at, remaining, resetAt, windowMinutes }));
    }
    return { history, writable: true };
  } catch { return { history: {}, writable: false }; }
}

export function collectUsageHistory(previous: UsageHistory, snapshot: UsageDashboardSnapshot): UsageHistory {
  let changed = false;
  const history: UsageHistory = {};
  for (const [key, samples] of Object.entries(previous)) {
    const recent = samples.filter(sample => valid(sample, snapshot.now));
    if (recent.length !== samples.length) changed = true;
    if (recent.length) history[key] = recent;
  }
  for (const account of snapshot.groups.flatMap(group => group.accounts)) {
    for (const window of windows) {
      const key = keyFor(account, window);
      const value = account.limits?.[window];
      const prior = history[key] ?? [];
      const at = account.limits?.updatedAt ?? 0;
      if (account.freshness === "fetching") continue;
      // Gaps, resets and missing reset identity break continuity rather than inventing a slope.
      if (account.freshness !== "fresh" || !value || value.resetsAt == null || value.resetsAt <= snapshot.now || !Number.isFinite(value.usedPercent) || value.usedPercent < 0 || value.usedPercent > 100) {
        if (prior.length) { delete history[key]; changed = true; }
        continue;
      }
      let samples = prior;
      const last = samples[samples.length - 1];
      const remaining = 100 - value.usedPercent;
      if (last && (last.resetAt !== value.resetsAt || last.windowMinutes !== value.windowMinutes || remaining > last.remaining || at - last.at > 30 * 60_000)) samples = [];
      const tail = samples[samples.length - 1];
      if (tail && (at <= tail.at || at - tail.at < HISTORY_INTERVAL_MS || remaining === tail.remaining)) continue;
      const sample = { at, remaining, resetAt: value.resetsAt, windowMinutes: value.windowMinutes };
      if (!valid(sample, snapshot.now)) continue;
      history[key] = [...samples, sample].slice(-HISTORY_MAX_SAMPLES);
      changed = true;
    }
  }
  const entries = Object.entries(history).sort((a, b) => b[1][b[1].length - 1].at - a[1][a[1].length - 1].at);
  if (entries.length > HISTORY_MAX_KEYS) changed = true;
  return changed ? Object.fromEntries(entries.slice(0, HISTORY_MAX_KEYS)) : previous;
}

export function usageTrend(history: UsageHistory, account: UsageAccount, window: typeof windows[number], now: number): { samples: UsageHistorySample[]; delta: number } | null {
  const value = account.limits?.[window];
  if (account.freshness !== "fresh" || !value || value.resetsAt == null || value.resetsAt <= now) return null;
  const samples = history[keyFor(account, window)] ?? [];
  if (samples.length < HISTORY_MIN_SAMPLES || samples.some((sample, index) => !valid(sample, now) || sample.resetAt !== value.resetsAt || sample.windowMinutes !== value.windowMinutes || (index > 0 && (sample.at - samples[index - 1].at < HISTORY_INTERVAL_MS || sample.at - samples[index - 1].at > 30 * 60_000 || sample.remaining > samples[index - 1].remaining)))) return null;
  const first = samples[0], last = samples[samples.length - 1];
  if (last.at > (account.limits?.updatedAt ?? 0) || now - last.at > 30 * 60_000 || last.remaining !== 100 - value.usedPercent) return null;
  return { samples, delta: last.remaining - first.remaining };
}
