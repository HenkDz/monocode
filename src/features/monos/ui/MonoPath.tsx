import { useState } from "react";
import { copyText } from "../../../platform/tauri/clipboard";
import { Copy } from "../../../shared/ui/icons";
import { monoDisplayPath } from "../model/monoDisplayPath";

export function MonoPath({ path, label, shortLabel }: { path: string; label: string; shortLabel?: string }) {
  const [status, setStatus] = useState<string>();
  return <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs">
    <span className="min-w-0 break-all" title={path}>{shortLabel ?? monoDisplayPath(path)}</span>
    <button type="button" aria-label={`Copy ${label} path`} title={path}
      className="grid size-7 shrink-0 place-items-center rounded-md text-content/50 hover:bg-content/8 hover:text-content focus-visible:outline-2 focus-visible:outline-accent"
      onClick={() => { void copyText(path).then(() => setStatus("Path copied"), () => setStatus("Could not copy path")); }}>
      <Copy aria-hidden="true" className="size-3.5" />
    </button>
    {status && <span role="status" className="w-full text-content/60">{status}</span>}
  </span>;
}
