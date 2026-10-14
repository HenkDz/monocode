import { useId } from "react";
import type { UsageAccount, UsageAssignment, UsageDashboardSnapshot } from "../model/usageDashboard";
import { usageTrend, type UsageHistory } from "../model/usageHistory";
import { clampUsedPercent, formatResetDuration, formatUsagePercent, formatWindowLabel, type RateLimitWindow } from "../model/rateLimits";
import { AccountStatusLabel } from "./ProviderAccountUsage";
import "./usageDashboard.css";

export function UsageAssignments({ assignments }: { assignments: UsageAssignment[] }) {
  return <div className="usage-associations">
    {assignments.length === 0 ? "No loaded Mono associations" : assignments.map(assignment =>
      <span className="usage-association" data-state={assignment.state} key={`${assignment.monoId}:${assignment.sessionId}`}
        title={`${assignment.kind} session: ${assignment.sessionId}`}>
        {assignment.name} · {assignment.state === "working" ? "working now" : assignment.state === "idle" ? "idle / configured" : "association unknown"} · {assignment.kind}
      </span>)}
  </div>;
}

function Trend({ account, window, history, now }: { account: UsageAccount; window: "session" | "weekly"; history: UsageHistory; now: number }) {
  const trend = usageTrend(history, account, window, now);
  if (!trend) return <span className="usage-trend">Trend unavailable</span>;
  const points = trend.samples.map((sample, index) => `${index * 60 / (trend.samples.length - 1)},${22 - sample.remaining * .2}`).join(" ");
  const delta = Math.round(trend.delta * 10) / 10;
  return <span className="usage-trend" aria-label={`Local trend: ${delta > 0 ? "+" : ""}${delta} percentage points across ${trend.samples.length} samples`}>
    <svg viewBox="0 0 62 24" aria-hidden="true"><polyline points={points} fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>
    <span>{delta > 0 ? "+" : ""}{delta} pts</span>
  </span>;
}

function WindowCell({ account, window, title, now, history }: { account: UsageAccount; window: "session" | "weekly" | "monthly"; title: string; now: number; history: UsageHistory }) {
  const quota: RateLimitWindow | null | undefined = account.limits?.[window];
  const available = quota && Number.isFinite(quota.usedPercent) && account.freshness !== "unavailable";
  const remaining = available ? 100 - clampUsedPercent(quota.usedPercent) : null;
  const tone = remaining == null || account.freshness !== "fresh" ? "unknown" : remaining <= 0 ? "exhausted" : remaining <= 20 ? "low" : "ready";
  const credits = account.limits?.resetCredits;
  return <td className="usage-window" data-tone={tone}>
    {remaining != null ? <>
      <div className="usage-window-head">
        <span className="usage-remaining">{formatUsagePercent(remaining)}<small>left{account.freshness !== "fresh" ? " · last known" : ""}</small></span>
        {window !== "monthly" ? <Trend account={account} window={window} history={history} now={now} /> : <span className="usage-trend">Trend unavailable</span>}
      </div>
      <div className="usage-bar" role="progressbar" aria-label={`${account.label} ${title} remaining`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(remaining)}><span style={{ width: `${remaining}%` }} /></div>
    </> : <div className="usage-window-unavailable">Unavailable · Trend unavailable</div>}
    <div className="usage-window-meta">
      <span>{quota?.resetsAt != null && Number.isFinite(quota.resetsAt)
        ? <>{quota.resetsAt <= now ? "Reset due · awaiting refresh" : <>Resets <time dateTime={new Date(quota.resetsAt).toISOString()}>{new Date(quota.resetsAt).toLocaleString()}</time> · in {formatResetDuration(quota.resetsAt - now)}</>}</>
        : "Reset not reported"}</span>
      <span>{credits != null ? `${credits.availableCount} reset credits` : "Credits not reported"}{quota ? ` · ${formatWindowLabel(quota.windowMinutes)} window` : ""}</span>
    </div>
  </td>;
}

export function UsageDashboard({ snapshot, history = {}, onRefresh, onOpenSettings }: {
  snapshot: UsageDashboardSnapshot; history?: UsageHistory; onRefresh?: () => void; onOpenSettings?: () => void;
}) {
  const id = useId();
  const refreshing = snapshot.groups.some(group => group.accounts.some(account => account.freshness === "fetching"));
  return <section className="usage-dashboard" aria-labelledby={`${id}-title`}>
    <header className="usage-dashboard-header">
      <div><h1 id={`${id}-title`} tabIndex={-1}>Room to keep working.</h1><p>Every account. Both windows. The Monos using them.</p></div>
      <div className="usage-dashboard-actions">
        {onRefresh && <button type="button" disabled={refreshing} onClick={onRefresh}>{refreshing ? "Refreshing…" : "Refresh usage"}</button>}
        {onOpenSettings && <button type="button" onClick={onOpenSettings}>Account failover settings</button>}
      </div>
    </header>
    <p className="usage-snapshot">Snapshot viewed <time dateTime={new Date(snapshot.now).toISOString()}>{new Date(snapshot.now).toLocaleString()}</time>. Each account shows its own freshness. Scroll a provider to compare all accounts.</p>
    {snapshot.groups.map(group => <section className="usage-provider" key={group.provider} aria-labelledby={`${id}-${group.provider}`}>
      <header className="usage-provider-heading"><h2 id={`${id}-${group.provider}`}>{group.label}</h2><span>{group.accounts.length} {group.accounts.length === 1 ? "account / context" : "accounts / contexts"}</span></header>
      {group.accounts.length === 0 ? <p className="usage-provider-footer">No configured accounts. Usage unavailable.</p> :
        <div className="usage-comparison" role="region" aria-label={`${group.label} account comparison, scroll horizontally`} tabIndex={0}>
          <table style={{ minWidth: group.accounts.length > 1 ? `${96 + group.accounts.length * 260}px` : "320px" }}>
            <caption className="sr-only">{group.label}: remaining quota per account and window</caption>
            <thead><tr><th scope="col">Account</th>{group.accounts.map(account => <th key={account.key} scope="col">
              <div className="usage-account-title"><strong>{account.label}</strong><small>{account.freshness === "fresh" ? "Fresh" : account.freshness === "stale" ? "Stale snapshot" : account.freshness === "fetching" ? "Fetching" : account.freshness === "error" ? "Fetch failed" : "Unavailable"}</small></div>
              <AccountStatusLabel status={account.status} />
              {account.limits?.updatedAt ? <div className="usage-window-meta">Last update {new Date(account.limits.updatedAt).toLocaleString()}</div> : null}
              <UsageAssignments assignments={account.assignments} />
            </th>)}</tr></thead>
            <tbody>{(["session", "weekly", ...(group.accounts.some(account => account.limits?.monthly) ? ["monthly"] : [])] as ("session" | "weekly" | "monthly")[]).map(window => {
              const title = window === "session" ? "Session" : window === "weekly" ? "Weekly" : "Monthly";
              return <tr key={window}><th scope="row">{title}</th>{group.accounts.map(account => <WindowCell key={account.key} account={account} window={window} title={title} now={snapshot.now} history={history} />)}</tr>;
            })}</tbody>
          </table>
        </div>}
      <footer className="usage-provider-footer"><strong>Pool note · </strong>{group.poolNote}</footer>
    </section>)}
    {snapshot.unknownAssignments.length > 0 && <section className="usage-provider" aria-label="Unknown account associations"><header className="usage-provider-heading"><h2>Account association unknown</h2></header><div className="usage-provider-footer"><UsageAssignments assignments={snapshot.unknownAssignments} /></div></section>}
    <p className="usage-dashboard-footer">Percentages show remaining allowance per account, never combined across pools. Trends use local samples within the same account and window. Trend unavailable until enough valid history exists. Reset credits belong to the account.</p>
  </section>;
}
