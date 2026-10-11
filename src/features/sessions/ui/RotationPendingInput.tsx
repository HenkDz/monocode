import { useState } from "react";
import { Modal } from "../../../shared/ui/Modal";
import type { MonoRotationDiscardPreview } from "../../monos/model/monoRotation";

export function RotationPendingInput({
  preview,
  onDiscard,
}: {
  preview?: MonoRotationDiscardPreview;
  onDiscard: (preview: MonoRotationDiscardPreview) => boolean;
}) {
  const [confirming, setConfirming] = useState<MonoRotationDiscardPreview>();
  const [failed, setFailed] = useState(false);
  if (!preview) return null;
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setFailed(false);
          setConfirming(preview);
        }}
        className="mx-3 my-1 rounded-md px-2 py-1 text-xs text-content/65 hover:bg-content/8 focus-visible:outline-accent"
      >
        Discard pending input
      </button>
      {confirming && (
        <Modal
          title="Discard pending input?"
          size="md"
          fitViewport
          onClose={() => setConfirming(undefined)}
        >
          <div className="flex flex-col gap-3 p-4 text-xs">
            <p>
              The following unaccepted inputs will be discarded from the next
              retry.
            </p>
            <pre
              className="max-h-[45dvh] overflow-auto whitespace-pre-wrap break-words rounded-md bg-content/5 p-3 font-sans"
              aria-label="Pending input to discard"
            >
              {confirming.inputs.join("\n\n")}
            </pre>
            <p className="text-content/60">
              Accepted constraints, the original assignment and conversation
              history are kept.
            </p>
            {failed && (
              <p role="alert">
                Could not discard pending input. It may have changed or could
                not be saved. Cancel and try again.
              </p>
            )}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirming(undefined)}
                className="rounded-md px-3 py-1.5 hover:bg-content/8"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  if (onDiscard(confirming)) setConfirming(undefined);
                  else setFailed(true);
                }}
                className="rounded-md bg-red-500/20 px-3 py-1.5 font-medium text-red-400 hover:bg-red-500/30"
              >
                Discard pending input
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
