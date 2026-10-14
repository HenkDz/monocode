import { useId, useRef, useState } from "react";
import { Popover } from "../../../shared/ui/Popover";
import { copyMessage } from "../../../platform/tauri/clipboard";
import { presentationText } from "../model/transcriptPresentation";

export function CompactToolOutput({
  output,
  title,
  preview = true,
  command = false,
}: {
  output: string;
  title: string;
  preview?: boolean;
  command?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [copyState, setCopyState] = useState("");
  const trigger = useRef<HTMLButtonElement>(null);
  const heading = useId();
  // Commands are shown verbatim: presentation filtering must never alter what a user approves.
  const text = command ? output : presentationText(output).trim();
  if (!text) return null;
  const structured = /(?:^|\n)\s*[{[]|[\[{]\s*"[^"\n]+"\s*:/.test(text);
  const excerpt = text.split("\n").slice(0, 3).map((line) => line.slice(0, 160)).join("\n");
  const label = command ? "View command" : "View full output";
  const close = () => { setOpen(false); trigger.current?.focus(); };
  return (
    <div className={preview || command ? "min-w-0 py-1" : "tool-output-affordance min-w-0 shrink-0"} data-tool-output>
      {preview ? (
        structured ? (
          <p className="text-xs text-content/75">Structured output</p>
        ) : (
          <pre className="max-h-16 overflow-hidden whitespace-pre-wrap break-words font-mono text-xs leading-5 text-content/75">{excerpt}</pre>
        )
      ) : null}
      <button
        type="button"
        ref={trigger}
        aria-haspopup="dialog"
        aria-label={label}
        title={label}
        onClick={(event) => { event.currentTarget.focus(); setOpen(true); }}
        className="rounded text-xs text-content/75 hover:text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        {label}
      </button>
      {open ? (
        <Popover anchor={trigger} width={560} maxHeight={440} role="dialog" aria-labelledby={heading} tabIndex={-1} autoFocus onDismiss={close} className="flex min-h-0 flex-col">
          <header className="flex items-center gap-2 border-b border-content/7 p-3">
            <h2 id={heading} className="min-w-0 flex-1 truncate text-sm font-medium text-content">{presentationText(title)}</h2>
            <button type="button" onClick={() => void copyMessage(text).then(() => setCopyState("Copied"), () => setCopyState("Couldn't copy output"))} className="rounded px-2 py-1 text-xs text-content/65 hover:bg-content/6 hover:text-content focus-visible:ring-2 focus-visible:ring-accent">Copy {command ? "command" : "output"}</button>
            <button type="button" onClick={close} aria-label="Close" className="rounded px-2 py-1 text-xs text-content/65 hover:bg-content/6 hover:text-content focus-visible:ring-2 focus-visible:ring-accent">Close</button>
          </header>
          {copyState ? <p role="status" className="px-4 pt-2 text-xs text-content/65">{copyState}</p> : null}
          <pre className="min-h-0 min-w-0 select-text overflow-auto whitespace-pre-wrap break-words p-4 font-mono text-xs leading-5 text-content/80">{text}</pre>
        </Popover>
      ) : null}
    </div>
  );
}
