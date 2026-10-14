import type { UsageDashboardSnapshot } from "../model/usageDashboard";
import { clampUsedPercent, formatResetDuration, formatUsagePercent } from "../model/rateLimits";
import "./usageDashboard.css";

export function UsageVital({ snapshot, onOpen }: { snapshot: UsageDashboardSnapshot; onOpen: () => void }) {
  const windows = snapshot.groups.flatMap(group => group.accounts.flatMap(account =>
    account.freshness !== "fresh" ? [] : (["session", "weekly", "monthly"] as const).flatMap(name => {
      const window = account.limits?.[name];
      return !window || !Number.isFinite(window.usedPercent) || (window.resetsAt != null && window.resetsAt <= snapshot.now) ? [] : [{ group, account, name, window, remaining: 100 - clampUsedPercent(window.usedPercent) }];
    })));
  const tightest = windows.reduce<(typeof windows)[number] | undefined>((min, window) => !min || window.remaining < min.remaining ? window : min, undefined);
  const low = new Set(windows.filter(window => window.remaining <= 20).map(window => window.account.key)).size;
  const unavailable = snapshot.groups.filter(group => !windows.some(window => window.group === group)).length;
  return <button type="button" className="usage-vital" onClick={onOpen} data-tone={!tightest ? "unknown" : tightest.remaining <= 0 ? "exhausted" : tightest.remaining <= 20 ? "low" : "ready"}>
    <span>Usage · open ↗</span>
    <strong data-unavailable={!tightest || undefined}>{tightest ? <>{formatUsagePercent(tightest.remaining)}<small>{tightest.name} left</small></> : "Usage unavailable"}</strong>
    {tightest && <small>{tightest.group.label} · {tightest.account.label}<br />{tightest.window.resetsAt == null ? "Reset not reported" : `Resets in ${formatResetDuration(tightest.window.resetsAt - snapshot.now)}`}</small>}
    <small>{low} {low === 1 ? "account" : "accounts"} low · {unavailable} {unavailable === 1 ? "provider" : "providers"} unavailable</small>
  </button>;
}

export function UsageAgentAccountLabels({ snapshot, monoId }: { snapshot: UsageDashboardSnapshot; monoId: string }) {
  const accounts = snapshot.groups.flatMap(group => group.accounts.flatMap(account => {
    const assignments = account.assignments.filter(assignment => assignment.monoId === monoId);
    if (!assignments.length) return [];
    const state = assignments.some(assignment => assignment.state === "working") ? "Working" : assignments.some(assignment => assignment.state === "unknown") ? "Unknown" : "Idle / configured";
    return [{ key: account.key, label: `${state} · ${group.label} / ${account.label}`, sessions: assignments.map(assignment => `${assignment.kind}: ${assignment.sessionId}`).join(", ") }];
  }));
  const unknown = snapshot.unknownAssignments.some(assignment => assignment.monoId === monoId);
  return <span className="usage-agent-accounts" aria-label="Loaded account associations">
    {accounts.map(account => <span key={account.key} title={account.sessions}>{account.label}</span>)}
    {unknown || accounts.length === 0 ? <span>Account association unknown</span> : null}
  </span>;
}
