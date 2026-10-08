import { useEffect, useState } from "react";
import { copyText } from "../../../platform/tauri/clipboard";

export function MonoCodexStorageNotice({
  onRepair,
  detail,
}: {
  onRepair: () => Promise<void>;
  detail?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [success, setSuccess] = useState(false);
  const [copyStatus, setCopyStatus] = useState<string>();
  useEffect(() => {
    if (detail) {
      setSuccess(false);
      setError(undefined);
      setCopyStatus(undefined);
    }
  }, [detail]);
  const details = error ?? detail;
  if (!details && !busy && !success) return null;
  return (
    <section
      role="status"
      aria-live="polite"
      aria-busy={busy}
      aria-label={
        success ? "Codex storage repaired" : "Codex storage needs repair"
      }
      className="mx-4 my-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm"
    >
      <p className="font-medium">
        {success ? "Codex storage repaired" : "Codex storage needs repair"}
      </p>
      {success ? (
        <button
          type="button"
          className="mt-2 rounded px-2 py-1 text-accent hover:bg-content/5 focus-visible:outline-accent"
          onClick={() => setSuccess(false)}
        >
          Dismiss
        </button>
      ) : (
        <>
          <button
            type="button"
            disabled={busy}
            className="mt-2 rounded px-2 py-1 text-accent hover:bg-content/5 focus-visible:outline-accent disabled:opacity-50"
            onClick={() => {
              setBusy(true);
              setError(undefined);
              setCopyStatus(undefined);
              void onRepair()
                .then(() => setSuccess(true))
                .catch((reason) => {
                  setError(
                    reason instanceof Error ? reason.message : String(reason),
                  );
                })
                .finally(() => setBusy(false));
            }}
          >
            {busy ? "Repairing…" : "Repair"}
          </button>
          {details && (
            <>
              <p
                role="alert"
                className="mt-1 break-all text-xs text-content/70"
              >
                {details}
              </p>
              <button
                type="button"
                className="mt-2 rounded px-2 py-1 text-accent hover:bg-content/5 focus-visible:outline-accent"
                onClick={() => {
                  void copyText(details).then(
                    () => setCopyStatus("Copied details"),
                    (reason) =>
                      setCopyStatus(
                        `Could not copy details: ${reason instanceof Error ? reason.message : String(reason)}`,
                      ),
                  );
                }}
              >
                Copy details
              </button>
              {copyStatus && (
                <p className="mt-1 text-xs text-content/70">{copyStatus}</p>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}
