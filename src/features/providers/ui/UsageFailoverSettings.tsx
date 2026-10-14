import { useEffect, useState } from "react";
import type { ProfileAccountProvider, ProviderAccount } from "../model/providerAccounts";
import {
  loadUsageFailoverPolicy,
  saveUsageFailoverPolicy,
  subscribeUsageFailoverPolicy,
} from "../model/usageFailoverSettings";
import type { UsageFailoverPolicy } from "../model/usageFailover";

export function UsageFailoverSettings({ provider, accounts }: {
  provider: ProfileAccountProvider;
  accounts: readonly ProviderAccount[];
}) {
  const [policy, setPolicy] = useState(() => loadUsageFailoverPolicy(provider));
  const [error, setError] = useState(false);
  useEffect(() => {
    setPolicy(loadUsageFailoverPolicy(provider));
    return subscribeUsageFailoverPolicy(() => setPolicy(loadUsageFailoverPolicy(provider)));
  }, [provider]);
  const candidates = accounts.filter(account => account.provider === provider);
  const ranked = policy.rankedAccountIds.flatMap(id => candidates.find(account => account.id === id) ?? []);
  const unranked = candidates.filter(account => !policy.rankedAccountIds.includes(account.id));
  const save = (next: UsageFailoverPolicy) => {
    const saved = saveUsageFailoverPolicy(provider, next);
    setError(!saved);
    if (saved) setPolicy(next);
  };
  const move = (index: number, direction: number) => {
    const ids = ranked.map(account => account.id);
    [ids[index], ids[index + direction]] = [ids[index + direction], ids[index]];
    save({ ...policy, rankedAccountIds: ids });
  };
  return (
    <fieldset className="min-w-0 space-y-3 rounded-lg border border-edge p-3">
      <legend className="px-1 text-sm font-medium">Usage limit recovery</legend>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" checked={policy.enabled}
          onChange={event => save({ ...policy, enabled: event.currentTarget.checked })} />
        <span>Automatic same-provider failover for {provider}</span>
      </label>
      <p className="text-xs text-content/60">Manual pause and choose is the default. Automatic recovery uses this order, skips exhausted, stale, unknown or unready accounts, and pauses to ask when none qualifies.</p>
      <ol aria-label={`${provider} failover account order`} className="space-y-2">
        {ranked.map((account, index) => (
          <li key={account.id} className="flex min-w-0 flex-wrap items-center gap-2 text-sm">
            <span className="min-w-0 flex-1 break-words">{index + 1}. {account.label}</span>
            <button type="button" className="px-1 text-xs" disabled={index === 0}
              aria-label={`Move ${account.label} earlier`} onClick={() => move(index, -1)}>Earlier</button>
            <button type="button" className="px-1 text-xs" disabled={index === ranked.length - 1}
              aria-label={`Move ${account.label} later`} onClick={() => move(index, 1)}>Later</button>
            <button type="button" className="px-1 text-xs" aria-label={`Remove ${account.label} from failover`}
              onClick={() => save({ ...policy, rankedAccountIds: ranked.filter(entry => entry.id !== account.id).map(entry => entry.id) })}>Remove</button>
          </li>
        ))}
      </ol>
      {unranked.map(account => <button key={account.id} type="button" className="mr-2 text-xs underline"
        onClick={() => save({ ...policy, rankedAccountIds: [...ranked.map(entry => entry.id), account.id] })}>
        Add {account.label} to order
      </button>)}
      {ranked.length === 0 && <p className="text-xs text-content/60">No ranked accounts. Recovery will pause and ask.</p>}
      {error && <p role="alert" className="text-xs text-red-400">Could not save recovery settings. Your previous setting remains active.</p>}
    </fieldset>
  );
}
