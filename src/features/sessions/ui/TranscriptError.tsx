import { useState } from "react";
import { Modal } from "../../../shared/ui/Modal";
import { copyText } from "../../../platform/tauri/clipboard";
import { transcriptError } from "../model/transcriptError";
import { presentationText } from "../model/transcriptPresentation";

export function TranscriptError({
  error,
  title,
  onRetry,
  recovery,
}: {
  error: string;
  title?: string;
  onRetry?: () => void;
  recovery?: { label: string; run(): void };
}) {
  const [details, setDetails] = useState(false);
  const [copyState, setCopyState] = useState("");
  const mapped = transcriptError(error);
  const diagnostics = presentationText(error);
  const subject = title?.replace(
    /^Couldn't complete (start|launch)\s+/i,
    (_match, verb: string) => `Couldn't ${verb.toLowerCase()} `,
  );
  const heading = subject
    ? `${subject}: ${mapped.title.toLowerCase()}`
    : mapped.title;
  const button =
    "rounded-md px-2 py-1 text-xs text-content/75 hover:bg-content/8 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent";
  return (
    <div
      data-transcript-error={mapped.family}
      className="my-2 rounded-xl border border-content/12 bg-content/4 p-3 font-sans text-sm"
    >
      <div role="alert">
        <strong className="font-medium text-content">{heading}</strong>
        <p className="mt-1 text-xs text-content/75">
          {mapped.cause} {mapped.action}
        </p>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1">
        {recovery && <button type="button" className={button} onClick={recovery.run}>{recovery.label}</button>}
        {onRetry && (
          <button type="button" className={button} onClick={onRetry}>
            Retry
          </button>
        )}
        <button
          type="button"
          aria-haspopup="dialog"
          className={button}
          onClick={(event) => {
            event.currentTarget.focus();
            setDetails(true);
          }}
        >
          Open details
        </button>
        <button
          type="button"
          className={button}
          onClick={() => {
            void copyText(diagnostics).then(
              () => setCopyState("Diagnostics copied"),
              () => setCopyState("Couldn't copy diagnostics"),
            );
          }}
        >
          Copy diagnostics
        </button>
        {copyState && (
          <span role="status" className="px-2 text-xs text-content/65">
            {copyState}
          </span>
        )}
      </div>
      {details && (
        <Modal title={heading} onClose={() => setDetails(false)} fitViewport>
          <pre className="max-h-[55vh] overflow-auto whitespace-pre-wrap break-words p-4 font-mono text-xs text-content/75">
            {diagnostics}
          </pre>
        </Modal>
      )}
    </div>
  );
}
