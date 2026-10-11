import { useEffect, useState, type ReactNode } from "react";
import { copyText } from "../../../platform/tauri/clipboard";
import { SecondaryButton } from "../../../shared/ui/SecondaryButton";
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
  detail,
  blockedContext,
  onResolve,
  onCompare,
  onReveal,
  renderDetails,
}: {
  onRepair: () => Promise<void>;
  detail?: string;
  blockedContext?: string;
  onResolve?: (resolution: CodexStorageResolution) => Promise<void>;
  onCompare?: () => Promise<CodexStorageComparison>;
  onReveal?: () => Promise<void>;
  renderDetails?: (content: ReactNode) => ReactNode;
}) {
  const [busy, setBusy] = useState<"repair" | "compare" | "reveal">();
  const [error, setError] = useState<string>();
  const [success, setSuccess] = useState(false);
  const [copyStatus, setCopyStatus] = useState<string>();
  const [comparison, setComparison] = useState<CodexStorageComparison>();
  const [conflict, setConflict] = useState(() => parseCodexStorageConflict(detail));
  const [recovery, setRecovery] = useState(() => parseCodexStorageRecoveryConflict(detail));
  const sandbox = parseCodexSandboxBlocker(error) ?? parseCodexSandboxBlocker(detail);
  useEffect(() => {
    setConflict(parseCodexStorageConflict(detail));
    setRecovery(parseCodexStorageRecoveryConflict(detail));
    if (detail) {
      setSuccess(false);
      setError(undefined);
      setCopyStatus(undefined);
      setComparison(undefined);
    }
  }, [detail]);

  const details = error ?? detail;
  const title = success ? sandbox ? "Codex sandbox choice applied" : "Codex storage repaired" : sandbox ? "Codex sandbox needs setup" : recovery ? "Codex recovery files preserved" : conflict ? codexStorageIssueTitle(conflict) : "Codex storage needs repair";
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
    <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-all">{details}</pre>
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
          {blockedContext && <p className="mt-1 text-xs text-content/70">{blockedContext}</p>}
          {sandbox && <div className="mt-2 text-xs text-content/70">
            <p>{sandbox.reason}</p>
            <p className="mt-2">Run setup yourself in PowerShell, then check again:</p>
            <pre className="mt-1 overflow-auto whitespace-pre-wrap break-all" aria-label="Sandbox setup command">{sandbox.setupCommand}</pre>
            <SecondaryButton disabled={!!busy} onClick={() => {
              void copyText(sandbox.setupCommand).then(() => setCopyStatus("Copied setup command"), reason => setCopyStatus(`Could not copy command: ${String(reason)}`));
            }}>Copy setup command</SecondaryButton>
            {copyStatus && <p className="mt-1">{copyStatus}</p>}
            <p className="mt-2">Switching this account to unelevated saves a config backup beside the config. Restore that backup to undo the change. Full access applies to this Mono; Plan stays restricted.</p>
          </div>}
          {conflict && (
            <p className="mt-1 text-xs text-content/70">
              Choose the file this Codex account should use. Both versions will be preserved.
            </p>
          )}
          {recovery && (
            <div className="mt-1 text-xs text-content/70">
              <p>{recovery.reason}</p>
              <p className="mt-1">Review the preserved files in their folder, then refresh this issue.</p>
              <ul aria-label="Preserved recovery paths" className="mt-1 space-y-1 break-all">
                {recovery.paths.map(path => <li key={path}>{path}</li>)}
              </ul>
            </div>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {sandbox ? <>
              <SecondaryButton disabled={!!busy} onClick={() => void run("repair", onRepair)}>{busy === "repair" ? "Checking…" : "Check setup again"}</SecondaryButton>
              {onResolve && <>
                <SecondaryButton disabled={!!busy} onClick={() => void run("repair", () => onResolve("use_unelevated_sandbox"))}>Switch this account to unelevated</SecondaryButton>
                <SecondaryButton disabled={!!busy} onClick={() => void run("repair", () => onResolve("use_mono_full_access"))}>Use full access for this Mono</SecondaryButton>
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
                {busy === "repair" ? "Repairing…" : recovery ? "Refresh issue" : "Repair"}
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
          </div>
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
          {error && <p role="alert" className="mt-2 break-all text-xs text-content/70">{parseCodexStorageRecoveryConflict(error)?.reason ?? (parseCodexStorageConflict(error) ? "The file changed again. Review the latest versions before choosing." : error)}</p>}
          {details && !sandbox && (renderDetails ? renderDetails(detailContent) : (
            <details className="mt-2 text-xs text-content/70">
              <summary className="cursor-pointer select-none rounded focus-visible:outline-accent">Details</summary>
              {detailContent}
            </details>
          ))}
        </>
      )}
    </section>
  );
}
