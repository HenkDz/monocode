import type { ProviderAccountIdentity } from "./providerAccountIdentity";
import type { HarnessId } from "../../sessions/model/session";
import {
  sameProviderAccountId,
  supportsAccountProfiles,
  type ProfileAccountProvider,
  type ProviderAccount,
} from "./providerAccounts";
import { RATE_LIMIT_POLL_MS, type ProviderRateLimits } from "./rateLimits";

export type UsageFailoverPolicy = { enabled: boolean; rankedAccountIds: string[] };
export const MANUAL_USAGE_FAILOVER: UsageFailoverPolicy = {
  enabled: false,
  rankedAccountIds: [],
};

export type UsageFailoverCandidate = {
  account: ProviderAccount;
  identity: ProviderAccountIdentity | null | undefined;
  /** A loaded, usable account; never infer readiness from a configured profile. */
  ready: boolean;
  limits: ProviderRateLimits | undefined;
};

/** Missing, stale, failed and already-reset windows require a fresh probe. */
export function eligibleUsageFailoverAccount(
  provider: ProfileAccountProvider,
  candidate: UsageFailoverCandidate,
  now: number,
): boolean {
  const { account, identity, ready, limits } = candidate;
  if (account.provider !== provider || !ready ||
      ![identity?.email, identity?.name, identity?.organization].some(value => value?.trim()) ||
      !limits || limits.provider !== provider || limits.status !== "ok" || limits.error ||
      !Number.isFinite(now) || !Number.isFinite(limits.updatedAt) ||
      limits.updatedAt <= 0 || limits.updatedAt > now || now - limits.updatedAt > RATE_LIMIT_POLL_MS ||
      !limits.session || !limits.weekly) return false;
  return [limits.session, limits.weekly, limits.monthly].every(window => !window ||
    Number.isFinite(window.usedPercent) && window.usedPercent >= 0 && window.usedPercent < 100 &&
    Number.isFinite(window.windowMinutes) && window.windowMinutes > 0 &&
    window.resetsAt != null && Number.isFinite(window.resetsAt) && window.resetsAt > now);
}

/** Rank is an explicit user choice; quota percentages are never averaged or ranked. */
export function selectUsageFailoverAccount(
  provider: HarnessId,
  currentAccountId: string | undefined,
  policy: UsageFailoverPolicy,
  candidates: readonly UsageFailoverCandidate[],
  now: number,
): ProviderAccount | null {
  if (!policy.enabled || !supportsAccountProfiles(provider)) return null;
  for (const id of policy.rankedAccountIds) {
    if (sameProviderAccountId(currentAccountId, id)) continue;
    const candidate = candidates.find(entry => entry.account.provider === provider && entry.account.id === id);
    if (candidate && eligibleUsageFailoverAccount(provider, candidate, now)) return candidate.account;
  }
  return null;
}
