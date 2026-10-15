import type { ProfileAccountProvider } from "./providerAccounts";
import { MANUAL_USAGE_FAILOVER, type UsageFailoverPolicy } from "./usageFailover";

export const USAGE_FAILOVER_SETTINGS_KEY = "monocode.usageFailover.v1";
const CHANGE_EVENT = "monocode-usage-failover-changed";
type Policies = Partial<Record<ProfileAccountProvider, UsageFailoverPolicy>>;

function validPolicy(value: unknown): value is UsageFailoverPolicy {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const policy = value as UsageFailoverPolicy;
  return typeof policy.enabled === "boolean" && Array.isArray(policy.rankedAccountIds) &&
    policy.rankedAccountIds.length <= 64 &&
    policy.rankedAccountIds.every(id => typeof id === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(id)) &&
    new Set(policy.rankedAccountIds).size === policy.rankedAccountIds.length;
}

function readPolicies(): Policies {
  const raw = localStorage.getItem(USAGE_FAILOVER_SETTINGS_KEY);
  if (raw === null) return {};
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.entries(value).some(([provider, policy]) =>
        !["claude", "codex"].includes(provider) || !validPolicy(policy))) {
    throw Error("Usage failover settings are unreadable. Manual recovery remains active.");
  }
  return value as Policies;
}

export function loadUsageFailoverPolicy(provider: ProfileAccountProvider): UsageFailoverPolicy {
  try {
    return readPolicies()[provider] ?? { ...MANUAL_USAGE_FAILOVER, rankedAccountIds: [] };
  } catch {
    return { ...MANUAL_USAGE_FAILOVER, rankedAccountIds: [] };
  }
}

/** Fail closed on failed writes; preserve unreadable settings rather than replacing them. */
export function saveUsageFailoverPolicy(provider: ProfileAccountProvider, policy: UsageFailoverPolicy): boolean {
  if (!validPolicy(policy) || !["claude", "codex"].includes(provider)) return false;
  try {
    const policies = readPolicies();
    localStorage.setItem(USAGE_FAILOVER_SETTINGS_KEY, JSON.stringify({ ...policies, [provider]: policy }));
    window.dispatchEvent(new Event(CHANGE_EVENT));
    return true;
  } catch {
    return false;
  }
}

export function subscribeUsageFailoverPolicy(listener: () => void): () => void {
  const storage = (event: StorageEvent) => {
    if (event.key === USAGE_FAILOVER_SETTINGS_KEY || event.key === null) listener();
  };
  window.addEventListener(CHANGE_EVENT, listener);
  window.addEventListener("storage", storage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, listener);
    window.removeEventListener("storage", storage);
  };
}
