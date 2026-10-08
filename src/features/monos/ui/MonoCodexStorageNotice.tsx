import { useState } from "react";

export function MonoCodexStorageNotice({ onRepair, detail }: { onRepair: () => Promise<void>; detail?: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  return <section role="status" aria-label="Codex storage needs repair" className="mx-4 my-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm">
    <p className="font-medium">Codex storage needs repair</p>
    <button type="button" disabled={busy} className="mt-2 rounded px-2 py-1 text-accent hover:bg-content/5 focus-visible:outline-accent disabled:opacity-50" onClick={() => {
      setBusy(true);
      setError(undefined);
      void onRepair().catch(reason => {
        console.error("Codex storage repair failed", reason);
        setError(String(reason));
      }).finally(() => setBusy(false));
    }}>{busy ? "Repairing…" : "Repair"}</button>
    {(error || detail) && <p role="alert" className="mt-1 break-all text-xs text-content/70">{error ?? detail}</p>}
  </section>;
}
