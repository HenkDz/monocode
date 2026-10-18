import { useSyncExternalStore } from "react";
import { findMono, monosSnapshot, subscribeMonos } from "../model/mono";
import { unlockMonoField } from "../model/monoTeam";

export function MonoFieldLock({ monoId, field }: { monoId: string; field: "name" | "specialty" | "soul" | "harness" | "model" | "modelSettings" }) {
  useSyncExternalStore(subscribeMonos, monosSnapshot);
  if (!findMono(monoId)?.userLockedFields?.includes(field)) return null;
  return <button type="button" aria-label={`Unlock ${field}`} className="rounded px-1 py-0.5 text-[11px] text-content/50 hover:bg-content/10" onClick={() => unlockMonoField(monoId, field)}>🔒 Set by you · unlock</button>;
}
