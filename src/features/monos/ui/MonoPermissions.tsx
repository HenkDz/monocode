import { useState } from "react";
import { IS_WIN } from "../../../platform/tauri/platform";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { codexWindowsSandbox } from "../../../integrations/harness/providers/codex/codexProtocol";
import { RUNTIME_MODE_LABEL, type RuntimeMode, type Session } from "../../sessions/model/session";
import { AccessPicker } from "../../sessions/ui/AccessPicker";
import { saveMonoRuntimeMode, updateMono, type Mono } from "../model/mono";
import { openCardSession } from "../model/monoCards";
import { monoRoleRuntimeMode, resetMonoRolePermissions } from "../model/monoRolePermissions";
import { Property } from "./monoPanelParts";

export function MonoPermissions({
  mono,
  harness,
  runtimeMode,
  runtimeModeSource,
  windowsSandbox,
  readOnly,
  busy,
  onRuntimeModeChange,
  onWindowsSandboxChange,
}: {
  mono?: Mono;
  harness: string;
  runtimeMode?: RuntimeMode;
  runtimeModeSource?: Session["runtimeModeSource"];
  windowsSandbox?: Session["windowsSandbox"];
  readOnly?: boolean;
  busy?: boolean;
  onRuntimeModeChange?: (mode: RuntimeMode, source?: Session["runtimeModeSource"]) => void;
  onWindowsSandboxChange?: (engine: Session["windowsSandbox"]) => void | Promise<void>;
}) {
  const [changingEngine, setChangingEngine] = useState(false);
  const [engineError, setEngineError] = useState<string>();
  const role = mono?.role;
  const desired = monoRoleRuntimeMode(role);
  const changeMode = (mode: RuntimeMode) => {
    if (mono) {
      saveMonoRuntimeMode(mono.id, mode);
      onRuntimeModeChange?.(mode, "user");
    } else onRuntimeModeChange?.(mode);
  };
  const reset = () => {
    if (!mono) return;
    const next = resetMonoRolePermissions(mono);
    saveMonoRuntimeMode(mono.id, next.runtimeMode, next.runtimeModeSource);
    onRuntimeModeChange?.(next.runtimeMode, next.runtimeModeSource);
  };
  const engine = runtimeMode ? codexWindowsSandbox({ codexStore: "mono", runtimeMode, windowsSandbox, readOnly }, IS_WIN) : undefined;
  const defaultEngine = runtimeMode ? codexWindowsSandbox({ codexStore: "mono", runtimeMode, readOnly }, IS_WIN) : undefined;
  const bypass = runtimeMode === "full-access" && !readOnly;
  const changeEngine = async (next: Session["windowsSandbox"]) => {
    if (!onWindowsSandboxChange || busy || changingEngine) return;
    setChangingEngine(true);
    setEngineError(undefined);
    try {
      await onWindowsSandboxChange(next);
      if (mono) updateMono(mono.id, current => ({ ...current, windowsSandbox: next }));
    } catch (error) { setEngineError(error instanceof Error ? error.message : String(error)); }
    finally { setChangingEngine(false); }
  };
  return <>
    <Property label="Permissions">
      <div className="flex min-w-0 flex-col items-start gap-1 pb-1" data-mono-role-permissions>
        {onRuntimeModeChange && runtimeMode ? <AccessPicker value={runtimeMode} onChange={changeMode} side="bottom" variant="plain" /> : <span className="py-1 text-xs">{runtimeMode ? RUNTIME_MODE_LABEL[runtimeMode] : "Open chat to view"}</span>}
        {role && runtimeMode && <>
          <span className="text-[11px] text-content/50">{runtimeModeSource === "role" ? "Role default" : "Set by you"}</span>
          {runtimeModeSource !== "role" && (onRuntimeModeChange || !mono?.sessionId ? <button type="button" onClick={reset} className="rounded text-left text-[11px] text-accent hover:underline focus-visible:outline-accent">Use role default ({RUNTIME_MODE_LABEL[desired]})</button> : <button type="button" onClick={() => openCardSession(mono.sessionId!)} className="rounded text-left text-[11px] text-accent hover:underline focus-visible:outline-accent">Open chat to use role default</button>)}
          <span className="text-[11px] text-content/50">{role === "member" ? "Workers use Auto with a workspace sandbox. You can change permissions at any time." : "Coordinators use full access to route and review work. You can change permissions at any time."}</span>
        </>}
        {readOnly && <span className="text-[11px] text-content/50">This task stays read-only.</span>}
      </div>
    </Property>
    {harness === "codex" && IS_WIN && runtimeMode && <Property label="Sandbox engine">
      <div className="flex min-w-0 flex-col items-start gap-1 pb-1" data-mono-windows-sandbox>
        <span className="py-1 text-xs">{bypass ? "Bypassed in Chat" : engine === "unelevated" ? "Unelevated" : engine === "elevated" ? "Elevated (blocked)" : "Inherited from account/project"}</span>
        {onWindowsSandboxChange && <SearchableSelect label="Windows sandbox engine" value={windowsSandbox ?? "default"} disabled={busy || changingEngine} searchable={false} variant="row" options={[
          { value: "default", label: defaultEngine ? "Default (unelevated)" : "Default (account/project)" },
          { value: "unelevated", label: "Unelevated" },
          { value: "elevated", label: "Elevated" },
        ]} onChange={value => {
          const next = value === "elevated" || value === "unelevated" ? value : undefined;
          void changeEngine(next);
        }} />}
        {busy && onWindowsSandboxChange && <span className="text-[11px] text-content/50">Stop this turn before changing its sandbox engine.</span>}
        {engineError && <span role="alert" className="text-[11px] text-danger">{engineError}</span>}
        {bypass && <span className="text-[11px] text-content/50">Plan stays restricted and uses {engine ?? "the account/project"} engine.</span>}
        {engine === "elevated" && <span className="text-[11px] text-content/50">Elevated restricted turns stay blocked before submission.</span>}
      </div>
    </Property>}
  </>;
}
