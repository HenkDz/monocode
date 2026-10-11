import { useState, type ComponentProps, type ReactNode } from "react";
import { workSummaryLine } from "../../sessions/model/transcriptActivity";
import { MonoActivityTrail } from "../../sessions/ui/AgentTranscript";
import { presentationText } from "../../sessions/model/transcriptPresentation";
import type { Mono, MonoLook } from "../model/mono";
import { MonoSidebar, MonoSidebarHeader } from "./MonoSidebar";
import { MemberWorkLog } from "./MemberWorkLog";
import {
  ACTIVITY_FILTERS,
  activityKind,
  type ActivityFilter,
} from "../model/memberActivity";

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
export function MonoActivityContent({
  member,
  readOutput = false,
  ...trail
}: ComponentProps<typeof MonoActivityTrail> & { member?: Mono }) {
  const [filter, setFilter] = useState<ActivityFilter>("all");
  // A settled turn sums up its work; a live one's steps speak for themselves.
  const summary = trail.live
    ? ""
    : presentationText(workSummaryLine(trail.blocks));
  const hasErrors = trail.blocks.some(
    (block) => activityKind(block) === "errors",
  );
  const blocks = trail.blocks.filter((block) => {
    const kind = activityKind(block);
    return kind && (filter === "all" || kind === filter);
  });
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
            {trail.live
              ? "Working"
              : member
                ? "Activity"
                : hasErrors
                  ? "Needs attention"
                  : "Finished"}
          </span>
          {summary ? <span className="truncate">· {summary}</span> : null}
        </p>
      </div>
      <div className="px-3 pb-4">
        <div
          role="group"
          aria-label="Filter activity"
          className="mb-4 flex flex-wrap gap-1.5"
        >
          {ACTIVITY_FILTERS.map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={filter === value}
              className={`rounded-full border px-2.5 py-1 text-xs capitalize focus-visible:outline-accent ${filter === value ? "border-content/20 bg-content/8 text-content" : "border-transparent text-content/75 hover:bg-content/5 hover:text-content"}`}
              onClick={() => setFilter(value)}
            >
              {value}
            </button>
          ))}
        </div>
        {member ? (
          <MemberWorkLog
            member={member}
            activity={{ filter, trail: { ...trail, readOutput } }}
          />
        ) : (
          <>
            <MonoActivityTrail
              {...trail}
              blocks={blocks}
              readOutput={readOutput}
            />
            {!blocks.length && (
              <p className="px-1 py-3 text-xs text-content/60">
                No {filter === "all" ? "activity" : filter} yet.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
