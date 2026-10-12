import { useEffect, useRef, useState } from "react";
import { hasHeadlessChildBackend, monoCodexStorageInfo, setMonoCodexHooksShared, retireMonoCodexCredentials, type MonoCodexStorageInfo, type CodexCredentialNamespace } from "../../../integrations/harness/core/child";
import { remoteProjectFor } from "../../connections/model/remoteProjects";
import { Property, SwitchRow } from "./monoPanelParts";
import { selectedProviderAccountId } from "../../providers/model/providerAccounts";
import { SecondaryButton } from "../../../shared/ui/SecondaryButton";
import { parseCodexStorageRecoveryConflict } from "../model/monoCodexStorage";

export function MonoCodexStorageSource({ harness, providerAccountId, cwd }: { harness: string; providerAccountId?: string; cwd: string }) {
  const [info, setInfo] = useState<MonoCodexStorageInfo>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const [confirmation, setConfirmation] = useState<CodexCredentialNamespace>();
  const saveRequest = useRef<object | undefined>(undefined);
  const accountId = providerAccountId ?? selectedProviderAccountId("codex", cwd);
  useEffect(() => {
    let live = true;
    saveRequest.current = undefined;
    setSaving(false);
    setError(undefined);
    setConfirmation(undefined);
    setInfo(undefined);
    if (harness === "codex" && !hasHeadlessChildBackend() && !remoteProjectFor(cwd))
      void monoCodexStorageInfo(accountId).then(value => { if (live) setInfo(value); })
        .catch(error => console.warn("Could not inspect Mono Codex storage source", error));
    return () => { live = false; saveRequest.current = undefined; };
  }, [harness, accountId, cwd]);

  async function setHooksShared(shared: boolean) {
    if (saving) return;
    const request = {};
    saveRequest.current = request;
    setSaving(true);
    setError(undefined);
    try {
      await setMonoCodexHooksShared(accountId, shared);
      if (saveRequest.current !== request) return;
      setInfo(previous => previous ? { ...previous, shareHooks: shared } : previous);
      const value = await monoCodexStorageInfo(accountId);
      if (saveRequest.current === request) setInfo(value);
    } catch (reason) {
      if (saveRequest.current === request) setError(parseCodexStorageRecoveryConflict(reason)?.reason ?? (reason instanceof Error ? reason.message : String(reason)));
    } finally {
      if (saveRequest.current === request) setSaving(false);
    }
  }

  async function retire(namespace: CodexCredentialNamespace) {
    if (saving || namespace.active) return;
    const request = {};
    saveRequest.current = request;
    setSaving(true); setError(undefined);
    try {
      await retireMonoCodexCredentials(accountId, namespace.receipt);
      const value = await monoCodexStorageInfo(accountId);
      if (saveRequest.current === request) { setInfo(value); setConfirmation(undefined); }
    } catch (reason) {
      if (saveRequest.current === request) setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      if (saveRequest.current === request) setSaving(false);
    }
  }

  return info ? <>
    <Property label="Selected Codex home"><span className="min-w-0 break-all text-xs" title={info.sourceHome}>{info.sourceHome} <span className="text-content/50">({info.sourceKind === "account" ? "Provider account" : info.sourceKind === "default" ? "~/.codex" : "CODEX_HOME"})</span></span></Property>
    <SwitchRow label={info.sourceKind === "default" ? "Share hooks from ~/.codex" : "Share account hooks"}
      description="Applies to all Monos using this account on their next turn. Off keeps Mono hooks private."
      on={info.shareHooks} disabled={saving} onChange={shared => { void setHooksShared(shared); }} />
    {info.credentialNamespaces?.map(namespace => <Property key={namespace.contextId} label={`${namespace.copies} private credential ${namespace.copies === 1 ? "copy" : "copies"}`}>
      <div className="min-w-0 text-xs">
        <p className="break-all">{namespace.home}</p>
        {namespace.active ? <p className="mt-1 text-content/60">Close every server using this context before clearing its copies.</p> : confirmation?.contextId === namespace.contextId ? <>
          <p className="mt-1">Clear this inactive context's recorded private credential entries, including any changed login in those entries. Source credentials, legacy entries, sessions and config are kept. Its next use copies credentials again from the source.</p>
          <div className="mt-2 flex flex-wrap gap-2"><SecondaryButton disabled={saving} onClick={() => { void retire(confirmation); }}>{saving ? "Clearing…" : "Confirm clear private credentials"}</SecondaryButton>
            <SecondaryButton disabled={saving} onClick={() => setConfirmation(undefined)}>Cancel</SecondaryButton></div>
        </> : <SecondaryButton disabled={saving} onClick={() => setConfirmation(namespace)}>Clear inactive private credentials</SecondaryButton>}
      </div>
    </Property>)}
    {error && <p role="alert" className="px-3 py-1 text-xs text-content/70">{error}</p>}
  </> : null;
}
