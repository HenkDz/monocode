import { useEffect, useState } from "react";
import { hasHeadlessChildBackend, monoCodexStorageInfo, type MonoCodexStorageInfo } from "../../../integrations/harness/core/child";
import { remoteProjectFor } from "../../connections/model/remoteProjects";
import { Property } from "./monoPanelParts";
import { selectedProviderAccountId } from "../../providers/model/providerAccounts";

export function MonoCodexStorageSource({ harness, providerAccountId, cwd }: { harness: string; providerAccountId?: string; cwd: string }) {
  const [info, setInfo] = useState<MonoCodexStorageInfo>();
  useEffect(() => {
    let live = true;
    setInfo(undefined);
    if (harness === "codex" && !hasHeadlessChildBackend() && !remoteProjectFor(cwd))
      void monoCodexStorageInfo(providerAccountId ?? selectedProviderAccountId("codex", cwd)).then(value => { if (live) setInfo(value); })
        .catch(error => console.warn("Could not inspect Mono Codex storage source", error));
    return () => { live = false; };
  }, [harness, providerAccountId, cwd]);
  return info ? <Property label="Selected Codex home"><span className="min-w-0 break-all text-xs" title={info.sourceHome}>{info.sourceHome} <span className="text-content/50">({info.sourceKind === "account" ? "Provider account" : info.sourceKind === "default" ? "~/.codex" : "CODEX_HOME"})</span></span></Property> : null;
}
