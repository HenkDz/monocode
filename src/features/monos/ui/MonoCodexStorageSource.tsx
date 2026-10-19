import { useEffect, useId, useRef, useState } from "react";
import { hasHeadlessChildBackend, monoCodexStorageInfo, setMonoCodexHooksShared, retireMonoCodexCredentials, type MonoCodexStorageInfo, type CodexCredentialNamespace } from "../../../integrations/harness/core/child";
import { remoteProjectFor } from "../../connections/model/remoteProjects";
import { Property, SwitchRow } from "./monoPanelParts";
import { selectedProviderAccountId } from "../../providers/model/providerAccounts";
import { SecondaryButton } from "../../../shared/ui/SecondaryButton";
import { parseCodexStorageRecoveryConflict } from "../model/monoCodexStorage";
import { ChevronDown, Lock } from "../../../shared/ui/icons";
import { MonoPath } from "./MonoPath";

export function MonoCodexStorageSource({ harness, providerAccountId, cwd }: { harness: string; providerAccountId?: string; cwd: string }) {
  const [info, setInfo] = useState<MonoCodexStorageInfo>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const [confirmation, setConfirmation] = useState<CodexCredentialNamespace>();
  const [contextsOpen, setContextsOpen] = useState(false);
  const contextsId = useId();
  const saveRequest = useRef<object | undefined>(undefined);
  const accountId = providerAccountId ?? selectedProviderAccountId("codex", cwd);
  useEffect(() => {
    let live = true;
    saveRequest.current = undefined;
    setSaving(false);
    setError(undefined);
    setConfirmation(undefined);
    setContextsOpen(false);
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

  const namespaces = info?.credentialNamespaces ?? [];
  const copies = namespaces.reduce((total, namespace) => total + namespace.copies, 0);
  const inUse = namespaces.reduce((total, namespace) => total + (namespace.active ? namespace.copies : 0), 0);
  return info ? <>
    <Property label="Selected Codex home"><span className="min-w-0"><MonoPath path={info.sourceHome} label="selected Codex home" /> <span className="text-xs text-content/50">({info.sourceKind === "account" ? "Provider account" : info.sourceKind === "default" ? "~/.codex" : "CODEX_HOME"})</span></span></Property>
    <SwitchRow label={info.sourceKind === "default" ? "Share hooks from ~/.codex" : "Share account hooks"}
      description="Applies to all Monos using this account on their next turn. Off keeps Mono hooks private."
      on={info.shareHooks} disabled={saving} onChange={shared => { void setHooksShared(shared); }} />
    {namespaces.length > 0 && <div className="my-2 overflow-hidden rounded-xl border border-stroke bg-content/2">
      <button type="button" aria-expanded={contextsOpen} aria-controls={contextsId}
        className="flex w-full items-center gap-2 px-3 py-3 text-left text-xs hover:bg-content/4 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
        onClick={() => setContextsOpen(!contextsOpen)}>
        <Lock aria-hidden="true" className="size-4 shrink-0 text-content/50" />
        <span className="min-w-0 flex-1 font-medium">Private credential copies: {copies} <span className="font-normal text-content/55">({inUse} in use)</span></span>
        <span className="text-content/60">Manage</span>
        <ChevronDown aria-hidden="true" className={`size-3.5 shrink-0 text-content/50 ${contextsOpen ? "rotate-180" : ""}`} />
      </button>
      <div id={contextsId} hidden={!contextsOpen} className="border-t border-stroke">
        <p className="px-3 pt-3 text-xs text-content/55">Copies belong to this account. Clear one inactive context at a time.</p>
        <ul aria-label="Private credential contexts" className="divide-y divide-stroke px-3">
        {namespaces.map((namespace, index) => <li key={namespace.contextId} className="min-w-0 py-3 text-xs">
        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
          <span className="font-medium">{namespace.contextId === "base" ? "Base context" : `Skill context ${index + 1}`}</span>
          <span className="rounded bg-content/5 px-2 py-0.5 text-content/60">{namespace.copies} {namespace.copies === 1 ? "copy" : "copies"} · {namespace.active ? "In use" : "Inactive"}</span>
        </div>
        <MonoPath path={namespace.home} shortLabel="Private Codex home" label={namespace.contextId === "base" ? "base context" : `skill context ${index + 1}`} />
        {namespace.active ? <p className="mt-1 text-content/60">Close every server using this context before clearing its copies.</p> : confirmation?.contextId === namespace.contextId ? <>
          <p className="mt-1">Clear this inactive context's recorded private credential entries, including any changed login in those entries. Source credentials, legacy entries, sessions and config are kept. Its next use copies credentials again from the source.</p>
          <div className="mt-2 flex flex-wrap gap-2"><SecondaryButton disabled={saving} onClick={() => { void retire(confirmation); }}>{saving ? "Clearing…" : "Confirm clear private credentials"}</SecondaryButton>
            <SecondaryButton disabled={saving} onClick={() => setConfirmation(undefined)}>Cancel</SecondaryButton></div>
        </> : <SecondaryButton disabled={saving} onClick={() => setConfirmation(namespace)}>Clear inactive private credentials</SecondaryButton>}
      </li>)}
        </ul>
      </div>
    </div>}
    {error && <p role="alert" className="px-3 py-1 text-xs text-content/70">{error}</p>}
  </> : null;
}
