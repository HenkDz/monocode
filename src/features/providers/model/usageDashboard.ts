import type { GoalViewInput } from "../../commandCenter/model/goalView";
import { selectAgentLiveState } from "../../agents/model/agentLiveState";
import { piBillingProvider, piUsageProvider } from "./piUsage";
import { accountStatus, type AccountStatus } from "./accountUsage";
import { RATE_LIMIT_POLL_MS, type ProviderRateLimits } from "./rateLimits";
import type { ProviderAccount } from "./providerAccounts";

export const USAGE_PROVIDERS = ["codex", "claude", "cursor", "opencode", "pi"] as const;
export type UsageProvider = typeof USAGE_PROVIDERS[number];
export const USAGE_FRESH_MS = RATE_LIMIT_POLL_MS * 2;
export type UsageAssignment = {
  monoId: string; name: string; sessionId: string;
  kind: "home" | "engine" | "task";
  state: "working" | "idle" | "unknown";
};
export type UsageAccount = {
  key: string; provider: UsageProvider; accountId: string; label: string;
  limits?: ProviderRateLimits;
  freshness: "fresh" | "stale" | "fetching" | "error" | "unavailable";
  status: AccountStatus; assignments: UsageAssignment[];
};
export type UsageProviderGroup = {
  provider: UsageProvider; label: string; accounts: UsageAccount[]; poolNote: string;
};
export type UsageDashboardSnapshot = {
  now: number; groups: UsageProviderGroup[]; unknownAssignments: UsageAssignment[];
};

export function usageFreshness(limits: ProviderRateLimits | undefined, now: number): UsageAccount["freshness"] {
  if (!limits || limits.status === "idle" || limits.status === "unavailable") return "unavailable";
  if (limits.status === "fetching") return "fetching";
  if (limits.status === "error") return "error";
  if (!Number.isFinite(limits.updatedAt) || limits.updatedAt <= 0 || limits.updatedAt > now || now - limits.updatedAt > USAGE_FRESH_MS) return "stale";
  if ([limits.session, limits.weekly, limits.monthly].some(window => window?.resetsAt != null && window.resetsAt <= now)) return "stale";
  return "fresh";
}

const labels: Record<UsageProvider, string> = { codex: "Codex", claude: "Claude", cursor: "Cursor", opencode: "OpenCode", pi: "Pi" };
const notes: Record<UsageProvider, string> = {
  codex: "Account windows apply separately. Shared account or pool identity is not inferred.",
  claude: "Session and weekly limits both apply. Shared account or pool identity is not inferred.",
  cursor: "Session / Weekly usage is unavailable from the current reader.",
  opencode: "OpenCode Go can report Session / Weekly / Monthly usage. Other configurations have no unified pool.",
  pi: "Recognized Anthropic / OpenAI Codex OAuth configurations can report usage. Pi identity is not linked to managed provider accounts.",
};

/** Join every loaded home, engine and task session; never infer identity from a project or representative session. */
export function selectUsageDashboard(input: Pick<GoalViewInput, "roster" | "runs" | "sessions" | "now"> & {
  accounts: readonly ProviderAccount[]; usage: Readonly<Record<string, ProviderRateLimits>>;
}): UsageDashboardSnapshot {
  const now = input.now ?? Date.now();
  const sessions = new Map(input.sessions.map(session => [session.id, session]));
  const accounts: UsageAccount[] = [];
  const add = (provider: UsageProvider, accountId: string, label: string, expected = provider as string) => {
    const key = `${provider}:${accountId}`;
    if (accounts.some(account => account.key === key)) return;
    const raw = input.usage[key];
    const limits = raw?.provider === expected ? raw : undefined;
    const freshness = usageFreshness(limits, now);
    accounts.push({ key, provider, accountId, label, limits, freshness,
      status: freshness === "fresh" ? accountStatus(limits, now) : { tone: freshness === "fetching" ? "checking" : "unknown", label: freshness === "stale" ? "Stale usage" : freshness === "error" ? "Usage failed" : freshness === "fetching" ? "Checking…" : "Usage unavailable", detail: null }, assignments: [] });
  };
  for (const account of input.accounts) {
    if (account.provider === "codex" || account.provider === "claude") add(account.provider, account.id, account.label);
  }
  add("cursor", "default", "Default context");
  add("opencode", "default", "OpenCode Go context");
  const piProviders = new Set(input.sessions.filter(session => session.harness === "pi").flatMap(session => piUsageProvider(session.model) ?? []));
  for (const provider of piProviders) add("pi", provider, provider === "anthropic" ? "Pi · Anthropic" : "Pi · OpenAI Codex", piBillingProvider(provider));
  if (!piProviders.size) add("pi", "unknown", "Configured provider unknown");
  const unknownAssignments: UsageAssignment[] = [];
  for (const mono of input.roster.filter(mono => mono.archivedAt == null)) {
    const links = new Map<string, UsageAssignment["kind"]>();
    const link = (id: string | undefined, kind: UsageAssignment["kind"]) => { if (id && !links.has(id)) links.set(id, kind); };
    link(mono.sessionId, "home");
    link(mono.managerEngineId, "engine");
    for (const run of input.runs) {
      if (run.ownerMonoId === mono.id || run.leadId === mono.managerEngineId) link(run.ownerSessionId ?? run.leadId, "engine");
      for (const task of run.tasks) if (task.memberId === mono.id) link(task.sessionId, "task");
    }
    for (const [sessionId, kind] of links) {
      const session = sessions.get(sessionId);
      const state = session ? selectAgentLiveState(session).status : undefined;
      const assignment: UsageAssignment = { monoId: mono.id, name: mono.name ?? mono.specialty ?? mono.mascot, sessionId, kind,
        state: !session ? "unknown" : state && ["thinking", "running-tool", "compacting"].includes(state) ? "working" : "idle" };
      const accountId = session?.harness === "pi" ? piUsageProvider(session.model) ?? "unknown" : session?.providerAccountId ?? "default";
      const account = session && accounts.find(account => account.provider === session.harness && account.accountId === accountId);
      if (account) account.assignments.push(assignment);
      else unknownAssignments.push(assignment);
    }
  }
  return { now, groups: USAGE_PROVIDERS.map(provider => ({ provider, label: labels[provider], accounts: accounts.filter(account => account.provider === provider), poolNote: notes[provider] })), unknownAssignments };
}
