import { useState, type ComponentProps, type ReactNode } from "react";
import { needsApproval, workSummaryLine } from "../../sessions/model/transcriptActivity";
import { Modal } from "../../../shared/ui/Modal";
import { MonoActivityTrail } from "../../sessions/ui/AgentTranscript";
import type { MonoLook } from "../model/mono";
import { MonoSidebar, MonoSidebarHeader } from "./MonoSidebar";
import { Empty } from "./monoPanelParts";

/** A selected turn's trail, in the order it happened. */
export function MonoActivityPanel({
  agent,
  onClose,
  windowControls,
  ...trail
}: ComponentProps<typeof MonoActivityTrail> & {
  agent: MonoLook;
  onClose: () => void;
  windowControls?: ReactNode;
}) {
  return (
    <MonoSidebar
      open
      kind="activity"
      label={`${agent.name} activity`}
      color={agent.color}
      windowControls={windowControls}
    >
      <MonoSidebarHeader title="Activity" onClose={onClose} />
      <MonoActivityContent {...trail} />
    </MonoSidebar>
  );
}

/** The existing trail, reusable inside the tabbed Details panel. */
export function MonoActivityContent(
  { readOutput = false, ...trail }: ComponentProps<typeof MonoActivityTrail>,
) {
  const [showWork, setShowWork] = useState(false);
  // A settled turn sums up its work; a live one's steps speak for themselves.
  const summary = trail.live ? "" : workSummaryLine(trail.blocks);
  if (!trail.blocks.length) return <Empty>No activity yet.</Empty>;
  return (
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-none">
      <div className="px-3 pb-3 pt-3">
        <p className="flex min-w-0 items-center gap-1.5 px-1 text-[11px] leading-4 text-content/45">
          <span
            aria-hidden
            className={`size-1.5 shrink-0 rounded-full ${
              trail.live
                ? "animate-pulse bg-[var(--mono-color)]"
                : "bg-content/30"
            }`}
          />
          <span className="shrink-0 text-content/70">
            {trail.live ? "Working" : "Finished"}
          </span>
          {summary ? <span className="truncate">· {summary}</span> : null}
        </p>
      </div>
      <div className="px-3 pb-4">
        {readOutput ? <MonoActivityTrail {...trail} readOutput /> : <>
          {trail.blocks.some(needsApproval) && <MonoActivityTrail {...trail} blocks={trail.blocks.filter(needsApproval)} />}
          <button type="button" onClick={() => setShowWork(true)} className="rounded-md px-2 py-1.5 text-xs text-content/60 hover:bg-content/5 hover:text-content focus-visible:outline-accent">Show work</button>
          {showWork && <Modal title="This agent's work" onClose={() => setShowWork(false)} fitViewport>
            <div className="p-4" onClickCapture={event => {
              if (event.target instanceof Element && event.target.closest("[data-org-artifact]")) setShowWork(false);
            }}><MonoActivityTrail {...trail} readOutput /></div>
          </Modal>}
        </>}
      </div>
    </div>
  );
}
