import { useEffect, useReducer } from "react";
import { projectKey, projectName } from "../../../shared/lib/paths";
import { subscribeProjectPathsChanged } from "../../projects/model/recents";
import { PixelMascot } from "../../projects/ui/PixelMascot";
import { projectMascot } from "../../projects/model/projectMascots";
import {
  loadTabGroupColors,
  loadTabGroupCustomColors,
  loadTabGroupMascots,
  resolveTabGroupColor,
  resolveTabGroupMascot,
} from "../../workspace/model/tabGroups";

export function ManagerAvatar({
  project,
  status,
}: {
  project: string;
  status?: "decision" | "ready" | "reply" | "running";
}) {
  const [, refresh] = useReducer((n: number) => n + 1, 0);
  useEffect(() => subscribeProjectPathsChanged(refresh), []);
  const key = projectKey(project);
  const seed = projectName(project);
  const color = resolveTabGroupColor(
    key,
    loadTabGroupColors(),
    loadTabGroupCustomColors(),
    seed,
  );
  return (
    <span
      aria-hidden
      className="relative inline-flex size-5 shrink-0 items-center justify-center rounded-full border border-current/20"
      style={{
        color,
        backgroundColor: `color-mix(in srgb, ${color} 14%, transparent)`,
      }}
    >
      <PixelMascot
        name={projectMascot(seed, resolveTabGroupMascot(key, loadTabGroupMascots())).name}
        color={color}
        still
        className="size-5"
      />
      {status && (
        <span
          className={`absolute -bottom-0.5 -right-0.5 size-2 rounded-full ring-2 ring-background-base ${status === "decision" ? "bg-amber-500" : status === "ready" ? "bg-emerald-500" : status === "reply" ? "bg-accent" : "bg-accent motion-safe:animate-pulse"}`}
        />
      )}
    </span>
  );
}
