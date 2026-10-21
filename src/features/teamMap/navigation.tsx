import { useCallback, useState } from "react";
import { Share } from "../../shared/ui/icons";
import { findMono } from "../monos/model/mono";

export function useTeamMap() {
  const [scope, setScope] = useState<string | null>();
  const show = useCallback((monoId?: string) => setScope(monoId ?? null), []);
  const close = useCallback(() => setScope(undefined), []);
  return {
    open: scope !== undefined,
    scope: scope ?? undefined,
    show,
    close,
  };
}

export function TeamMapNav({
  onOpen,
  compact = false,
}: {
  onOpen: () => void;
  compact?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      title="Command map"
      aria-label="Command map"
      className={`flex shrink-0 items-center gap-2 rounded-md text-[13px] text-content/65 hover:bg-content/8 hover:text-content focus-visible:outline-accent ${compact ? "mx-auto size-8 justify-center" : "mx-2 my-1 h-8 px-2"}`}
    >
      <Share className="size-4" strokeWidth={1.75} />
      {!compact && "Command map"}
    </button>
  );
}

export function TeamMapHeaderAction({
  monoId,
  onOpen,
}: {
  monoId?: string;
  onOpen: (scope?: string) => void;
}) {
  const mono = monoId ? findMono(monoId) : undefined;
  if (!mono || (mono.role !== "manager" && mono.role !== "orchestrator"))
    return null;
  return (
    <button
      type="button"
      onClick={() => onOpen(mono.role === "manager" ? mono.id : undefined)}
      title="Open Command map"
      aria-label="Open Command map"
      className="flex h-6 shrink-0 items-center gap-1.5 rounded-md bg-content/5 px-2 text-[12px] text-content/70 hover:bg-content/8 hover:text-content focus-visible:outline-accent"
    >
      <Share className="size-3.5" />
      Command map
    </button>
  );
}
