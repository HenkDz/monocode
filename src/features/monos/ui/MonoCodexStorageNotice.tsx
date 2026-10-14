import { useEffect, useState, type ReactNode } from "react";
import { copyText } from "../../../platform/tauri/clipboard";
import { SecondaryButton } from "../../../shared/ui/SecondaryButton";
import type { Session } from "../../sessions/model/session";
import {
  codexStorageIssueTitle,
  parseCodexStorageConflict,
  parseCodexStorageRecoveryConflict,
  parseCodexSandboxBlocker,
  type CodexStorageComparison,
  type CodexStorageResolution,
} from "../model/monoCodexStorage";

export function MonoCodexStorageNotice({
  onRepair,
  detail: suppliedDetail,
  homeThreads,
  advisory = false,
  blockedContext,
  onResolve,
  onCompare,
  onReveal,
  renderDetails,
  workbench = false,
  allowFullAccess = true,
  explicitElevated = false,
  remote = false,
}: {
  onRepair: () => Promise<void>;
  detail?: string;
  homeThreads?: Session["codexHomeThreadsRecovery"];
  advisory?: boolean;
  blockedContext?: string;
  onResolve?: (resolution: CodexStorageResolution) => Promise<void>;
  onCompare?: () => Promise<CodexStorageComparison>;
  onReveal?: () => Promise<void>;
  renderDetails?: (content: ReactNode) => ReactNode;
  workbench?: boolean;
  allowFullAccess?: boolean;
  explicitElevated?: boolean;
  remote?: boolean;
}) {
  const detail = homeThreads ? `Codex storage needs repair: ${JSON.stringify({ recovery: true,
    reason: "Preserve the unreadable per-home provider thread map. Conversation edits are not saved yet; keep this conversation open until recovery saves them. The stored map, transcript and provider conversation remain intact.",
    paths: [homeThreads.home ?? homeThreads.cwd], homeThreads,
  })}` : suppliedDetail;
  const [busy, setBusy] = useState<"repair" | "compare" | "reveal">();
  const [error, setError] = useState<string>();
  const [success, setSuccess] = useState(false);
  const [copyStatus, setCopyStatus] = useState<string>();
  const [comparison, setComparison] = useState<CodexStorageComparison>();
  const [conflict, setConflict] = useState(() => parseCodexStorageConflict(detail));
  const [recovery, setRecovery] = useState(() => parseCodexStorageRecoveryConflict(detail));
  const [sandbox, setSandbox] = useState(() => parseCodexSandboxBlocker(detail));
  const setupUnavailable = sandbox?.reason.includes("Manual setup alone cannot unlock elevated Mono turns");
  useEffect(() => {
    setConflict(parseCodexStorageConflict(detail));
    setRecovery(parseCodexStorageRecoveryConflict(detail));
    if (detail || (!busy && !success)) setSandbox(parseCodexSandboxBlocker(detail));
    if (detail) {
      setSuccess(false);
      setError(undefined);
      setCopyStatus(undefined);
      setComparison(undefined);
    }
  }, [detail]);

  const details = error ?? detail;
  const title = success ? sandbox ? "Codex sandbox choice applied" : "Codex storage repaired" : sandbox ? setupUnavailable ? "Codex elevated sandbox unavailable" : "Codex sandbox needs setup" : recovery?.homeThreads ? "Conversation edits are not saved" : recovery?.sourceBinding ? "Choose this Mono's Codex source" : recovery?.io?.retryable ? "Codex file is in use" : recovery ? "Codex recovery files preserved" : conflict ? codexStorageIssueTitle(conflict) : workbench ? "Conversation couldn’t start" : "Codex storage needs repair";
  async function run(action: "repair" | "compare" | "reveal", operation: () => Promise<unknown>) {
    if (busy) return;
    setBusy(action);
    setError(undefined);
    setCopyStatus(undefined);
    try {
      await operation();
      if (action === "repair") {
        setSuccess(true);
        setComparison(undefined);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      const updatedSandbox = parseCodexSandboxBlocker(reason);
      if (updatedSandbox) setSandbox(updatedSandbox);
      const updatedConflict = parseCodexStorageConflict(reason);
      const updatedRecovery = parseCodexStorageRecoveryConflict(reason);
      if (updatedConflict || updatedRecovery) {
        setConflict(updatedConflict);
        setRecovery(updatedRecovery);
        setComparison(undefined);
      }
    } finally {
      setBusy(undefined);
    }
  }

  if (!details && !busy && !success) return null;
  const detailContent = <>
    <pre tabIndex={0} className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-all">{details}</pre>
    <div className="mt-2">
      <SecondaryButton onClick={() => {
        void copyText(details ?? "").then(
          () => setCopyStatus("Copied details"),
          reason => setCopyStatus(
            `Could not copy details: ${reason instanceof Error ? reason.message : String(reason)}`,
          ),
        );
      }}>Copy details</SecondaryButton>
    </div>
    {copyStatus && <p className="mt-1">{copyStatus}</p>}
  </>;
  if (advisory && recovery?.sourceBinding?.canReturn) return (
    <div className="mx-4 my-2 text-xs text-content/70">
      <div className="flex items-center gap-2">
        <span>Codex source ·</span>
        {!remote && onResolve && <SecondaryButton disabled={!!busy} title={`Selected source: ${recovery.sourceBinding.resolvedSourceHome}\nOriginal source: ${recovery.sourceBinding.boundSourceHome}`} onClick={() => void run("repair", () => onResolve("reattach_original_source"))}>Return to original home</SecondaryButton>}
        {remote && <span>Inspect on the remote host</span>}
      </div>
      {error && <p role="alert" className="mt-1 break-all">{error}</p>}
      {success && <p className="mt-1">Codex source choice applied.</p>}
    </div>
  );
  return (
    <section
      role="status"
      aria-live="polite"
      aria-busy={!!busy}
      aria-label={title}
      className="mx-4 my-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm"
    >
      <p className="font-medium">{title}</p>
      {success ? (
        <div className="mt-2 flex items-center gap-3">
          <p className="text-xs text-content/70">Waiting messages can continue.</p>
          <SecondaryButton onClick={() => setSuccess(false)}>Dismiss</SecondaryButton>
        </div>
      ) : (
        <>
          {workbench && !sandbox && !conflict && !recovery && <p className="mt-2 text-xs leading-relaxed text-content/70">Codex couldn’t open its conversation store. Work is waiting; your messages are still here.</p>}
          {blockedContext && <p className="mt-1 text-xs text-content/70">{blockedContext}</p>}
          {remote && <p className="mt-2 text-xs text-content/70">Inspect and repair Codex storage on the remote host.</p>}
          {sandbox && <div className="mt-2 text-xs text-content/70">
            <p>{sandbox.reason}</p>
            {explicitElevated && <p className="mt-2">This Mono is set to Elevated. In Permissions, change Sandbox engine to Default or Unelevated, then retry its held message.</p>}
            {!setupUnavailable && <>
            <p className="mt-2">Run setup yourself in PowerShell, then check again:</p>
            <pre className="mt-1 overflow-auto whitespace-pre-wrap break-all" aria-label="Sandbox setup command">{sandbox.setupCommand}</pre>
            <SecondaryButton disabled={!!busy} onClick={() => {
              void copyText(sandbox.setupCommand).then(() => setCopyStatus("Copied setup command"), reason => setCopyStatus(`Could not copy command: ${String(reason)}`));
            }}>Copy setup command</SecondaryButton>
            </>}
            {copyStatus && <p className="mt-1">{copyStatus}</p>}
            <p className="mt-2">Unelevated applies to this account's Monos and saves a backup of their private config. Your own Codex config stays unchanged. Restore the private backup to undo the change. Full access applies to this Mono; Plan stays restricted.</p>
            {!allowFullAccess && <p className="mt-1">Full access cannot repair Plan, orchestrate or read-only messages.</p>}
          </div>}
          {conflict && (
            <p className="mt-1 text-xs text-content/70">
              Choose the file this Codex account should use. Both versions will be preserved.
            </p>
          )}
          {recovery && (
            <div className="mt-1 text-xs text-content/70">
              <p>{recovery.reason}</p>
              {recovery.sourceBinding ? <>
                <p className="mt-1 break-all">Selected source: {recovery.sourceBinding.resolvedSourceHome}</p>
                {recovery.sourceBinding.boundSourceHome && <p className="mt-1 break-all">Original source: {recovery.sourceBinding.boundSourceHome}</p>}
                {recovery.sourceBinding.canSeparate && <p className="mt-1">This starts a new provider conversation in a separate private home. The held prompt and queue stay here; original homes, history and credentials stay in place.</p>}
                {recovery.sourceBinding.canReturn && <p className="mt-1">Confirm this recreated source to return to its original private history. Each launch source keeps its own provider conversation.</p>}
                {recovery.sourceBinding.canBind && <p className="mt-1">Confirm only after selecting the account that originally owned these private sessions. Legacy context links alone do not establish that ownership.</p>}
              </> : recovery.io?.retryable ? <p className="mt-1">Waiting messages will continue automatically when this file is available.</p> : <p className="mt-1">Review the preserved files in their folder, then refresh this issue.</p>}
              <ul aria-label="Preserved recovery paths" className="mt-1 space-y-1 break-all">
                {recovery.paths.map(path => <li key={path}>{path}</li>)}
              </ul>
            </div>
          )}
          {!remote && <div className="mt-2 flex flex-wrap items-center gap-2">
            {recovery?.homeThreads && onResolve && <SecondaryButton disabled={!!busy} onClick={() => void run("repair", () => onResolve("preserve_home_threads"))}>Preserve stored map aside and start a fresh map</SecondaryButton>}
            {recovery?.sourceBinding?.canBind && onResolve && <SecondaryButton disabled={!!busy} onClick={() => void run("repair", () => onResolve("bind_selected_source"))}>Confirm selected source as original account</SecondaryButton>}
            {recovery?.sourceBinding?.canSeparate && onResolve && <SecondaryButton disabled={!!busy} onClick={() => void run("repair", () => onResolve("separate_selected_source"))}>Use a separate Mono home for this source</SecondaryButton>}
            {recovery?.sourceBinding?.canReturn && onResolve && <SecondaryButton disabled={!!busy} onClick={() => void run("repair", () => onResolve("reattach_original_source"))}>Return to original home / re-attach source</SecondaryButton>}
            {recovery?.migration && onResolve && <SecondaryButton disabled={!!busy} onClick={() => void run("repair", () => onResolve("keep_private_history"))}>Keep private history and retry migration</SecondaryButton>}
            {recovery?.metadata && onResolve && (
              <SecondaryButton disabled={!!busy} onClick={() => void run("repair", () => onResolve("preserve_recovery_metadata"))}>
                Archive incomplete metadata
              </SecondaryButton>
            )}
            {sandbox ? <>
              {!setupUnavailable && <SecondaryButton disabled={!!busy} onClick={() => void run("repair", onRepair)}>{busy === "repair" ? "Checking…" : "Check setup again"}</SecondaryButton>}
              {onResolve && <>
                {!explicitElevated && <SecondaryButton disabled={!!busy} onClick={() => void run("repair", () => onResolve("use_unelevated_sandbox"))}>Use unelevated sandbox for Monos</SecondaryButton>}
                {allowFullAccess && <SecondaryButton disabled={!!busy} onClick={() => void run("repair", () => onResolve("use_mono_full_access"))}>Use full access for this Mono</SecondaryButton>}
              </>}
            </> : conflict && onResolve ? (
              <>
                <SecondaryButton
                  disabled={!!busy}
                  title={conflict.sourcePath}
                  onClick={() => void run("repair", () => onResolve("use_account_version"))}
                >
                  {busy === "repair" ? "Repairing…" : /[\\/]\.codex[\\/]/.test(conflict.sourcePath) ? "Use ~/.codex version" : "Use account version"}
                  <span className="text-content/50">Recommended</span>
                </SecondaryButton>
                <SecondaryButton
                  disabled={!!busy || !conflict.canKeepMono}
                  title={conflict.canKeepMono ? conflict.monoPath : "Credential files must use the account version"}
                  onClick={() => void run("repair", () => onResolve("keep_mono_version"))}
                >Keep MonoCode version</SecondaryButton>
              </>
            ) : (
              <SecondaryButton disabled={!!busy} onClick={() => void run("repair", onRepair)}>
                {busy === "repair" ? "Repairing…" : recovery ? "Refresh issue" : workbench ? "Resolve storage" : "Repair"}
              </SecondaryButton>
            )}
            {conflict && onCompare && (
              <SecondaryButton disabled={!!busy} onClick={() => void run("compare", async () => setComparison(await onCompare()))}>
                {busy === "compare" ? "Loading…" : "Compare"}
              </SecondaryButton>
            )}
            {(conflict || recovery) && onReveal && (
              <SecondaryButton disabled={!!busy} onClick={() => void run("reveal", onReveal)}>Show in folder</SecondaryButton>
            )}
            {error && conflict && (
              <SecondaryButton disabled={!!busy} onClick={() => void run("repair", onRepair)}>Refresh issue</SecondaryButton>
            )}
          </div>}
          {comparison && conflict && (
            <div className="mt-3 rounded-md border border-content/10 p-2 text-xs">
              {comparison.unavailable ? <p>{comparison.unavailable}</p> : (
                <>
                  <div className="grid gap-3 md:grid-cols-2">
                    {[
                      { label: "Account version", path: conflict.sourcePath, bytes: conflict.sourceBytes, content: comparison.sourceContent },
                      { label: "MonoCode version", path: conflict.monoPath, bytes: conflict.monoBytes, content: comparison.monoContent },
                    ].map(version => (
                      <section key={version.label} aria-label={version.label} className="min-w-0">
                        <p className="font-medium">{version.label} · {version.bytes.toLocaleString()} bytes</p>
                        <p className="mt-1 break-all text-content/50">{version.path}</p>
                        <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded bg-content/5 p-2">{version.content?.slice(0, 65536) ?? "Content unavailable"}</pre>
                      </section>
                    ))}
                  </div>
                  {(comparison.truncated || (comparison.sourceContent?.length ?? 0) > 65536 || (comparison.monoContent?.length ?? 0) > 65536) &&
                    <p className="mt-2 text-content/60">Preview truncated. Full files are preserved on disk.</p>}
                </>
              )}
              <div className="mt-2"><SecondaryButton onClick={() => setComparison(undefined)}>Close comparison</SecondaryButton></div>
            </div>
          )}
          {error && <p role="alert" className="mt-2 break-all text-xs text-content/70">{parseCodexSandboxBlocker(error)?.reason ?? parseCodexStorageRecoveryConflict(error)?.reason ?? (parseCodexStorageConflict(error) ? "The file changed again. Review the latest versions before choosing." : error)}</p>}
          {details && !sandbox && (renderDetails ? renderDetails(detailContent) : (
            <div className="mt-2 text-xs text-content/70" aria-label="Storage diagnostic details">
              {detailContent}
            </div>
          ))}
        </>
      )}
    </section>
  );
}
