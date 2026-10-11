import { useEffect, useRef, useState } from "react";
import { hasHeadlessChildBackend, monoCodexStorageInfo, setMonoCodexHooksShared, type MonoCodexStorageInfo } from "../../../integrations/harness/core/child";
import { remoteProjectFor } from "../../connections/model/remoteProjects";
import { Property, SwitchRow } from "./monoPanelParts";
import { selectedProviderAccountId } from "../../providers/model/providerAccounts";

export function MonoCodexStorageSource({ harness, providerAccountId, cwd }: { harness: string; providerAccountId?: string; cwd: string }) {
  const [info, setInfo] = useState<MonoCodexStorageInfo>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const saveRequest = useRef<object | undefined>(undefined);
  const accountId = providerAccountId ?? selectedProviderAccountId("codex", cwd);
  useEffect(() => {
    let live = true;
    saveRequest.current = undefined;
    setSaving(false);
    setError(undefined);
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
    {error && <p role="alert" className="px-3 py-1 text-xs text-content/70">{error}</p>}
  </> : null;
}
