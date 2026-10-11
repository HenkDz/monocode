import { useRef, useState } from "react";
import {
  contextRatio,
  contextTooltip,
  formatTokens,
  type ContextUsage,
} from "../model/contextUsage";
import { Popover } from "../../../shared/ui/Popover";

const SIZE = 14;
const STROKE = 2;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/** Ring turns amber then red as the window fills. */
function ringClass(ratio: number): string {
  if (ratio >= 0.9) return "text-red-400";
  if (ratio >= 0.75) return "text-amber-400";
  return "text-content/45";
}

/**
 * Circular gauge for how full the model context window is.
 *
 * Unknown limits stay in words, without a guessed percentage ring.
 */
export function ContextMeter({
  usage,
  onCompact,
  compactDisabled = false,
  rotationScheduled = false,
}: {
  usage?: ContextUsage;
  onCompact?: () => void;
  compactDisabled?: boolean;
  rotationScheduled?: boolean;
}) {
  const [hovered, setHovered] = useState(false);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const ratio = contextRatio(usage);
  if (!usage || !Number.isFinite(usage.used) || usage.used < 0) return null;

  const { headline, detail } = contextTooltip(usage);
  const threshold = usage.effectiveCompactionThreshold;
  const thresholdLabel =
    threshold != null && Number.isFinite(threshold) && threshold > 0
      ? `Context refresh threshold: ${formatTokens(threshold)} tokens`
      : "Context refresh threshold unknown";
  const rotationLabel = rotationScheduled
    ? "Will refresh context before next turn"
    : undefined;
  const label = `${headline}, ${detail}. ${thresholdLabel}${rotationLabel ? `. ${rotationLabel}` : ""}`;
  const actionsOpen = open && onCompact != null;

  return (
    <div
      ref={root}
      className="relative shrink-0"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setHovered(true)}
      onBlur={() => setHovered(false)}
    >
      {onCompact ? (
        <button
          type="button"
          title="Context usage"
          aria-label={`${label}. Open context actions`}
          aria-expanded={actionsOpen}
          onClick={() => setOpen((value) => !value)}
          className="-m-1 grid rounded-sm p-1 outline-none focus-visible:ring-1 focus-visible:ring-accent"
        >
          {ratio === null ? (
            <span className="text-[11px] text-content/50">{headline}</span>
          ) : (
            <MeterRing ratio={ratio} />
          )}
        </button>
      ) : ratio === null ? (
        <span
          className="text-[11px] text-content/50"
          title={label}
          role="img"
          aria-label={label}
        >
          {headline}
        </span>
      ) : (
        <MeterRing ratio={ratio} label={label} />
      )}
      {hovered || actionsOpen ? (
        <Popover
          anchor={root}
          side="top"
          align="end"
          onDismiss={onCompact ? () => setOpen(false) : undefined}
          className={`w-max px-2.5 py-1.5 ${actionsOpen ? "" : "pointer-events-none"}`}
        >
          <div className="text-[12px] leading-4 text-content">{headline}</div>
          <div className="text-[11px] leading-4 text-content/50">{detail}</div>
          <div className="text-[11px] leading-4 text-content/50">
            {thresholdLabel}
          </div>
          {rotationLabel ? (
            <div className="text-[11px] leading-4 text-content">
              {rotationLabel}
            </div>
          ) : null}
          {actionsOpen ? (
            <button
              type="button"
              disabled={compactDisabled}
              title={
                compactDisabled
                  ? "Wait for the current operation to finish"
                  : "Compact this conversation's context"
              }
              onClick={() => {
                setOpen(false);
                onCompact?.();
              }}
              className="mt-1.5 w-full rounded-md bg-content/10 px-2 py-1 text-[11px] text-content hover:bg-content/15 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Compact now
            </button>
          ) : null}
        </Popover>
      ) : null}
    </div>
  );
}

function MeterRing({ ratio, label }: { ratio: number; label?: string }) {
  return (
    <svg
      width={SIZE}
      height={SIZE}
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      className={ringClass(ratio)}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <circle
        cx={SIZE / 2}
        cy={SIZE / 2}
        r={RADIUS}
        fill="none"
        stroke="currentColor"
        strokeWidth={STROKE}
        className="opacity-25"
      />
      <circle
        cx={SIZE / 2}
        cy={SIZE / 2}
        r={RADIUS}
        fill="none"
        stroke="currentColor"
        strokeWidth={STROKE}
        strokeLinecap="round"
        strokeDasharray={CIRCUMFERENCE}
        strokeDashoffset={CIRCUMFERENCE * (1 - ratio)}
        transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
      />
    </svg>
  );
}
