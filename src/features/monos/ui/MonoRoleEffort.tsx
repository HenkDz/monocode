import type { ReactNode } from "react";
import { modelEffortSetting, type AgentModel, type EffortSource } from "../../sessions/model/models";
import type { Mono } from "../model/mono";
import { monoRoleEffort } from "../model/monoRoleEffort";

export function MonoRoleEffort({
  mono,
  model,
  values,
  source,
  onReset,
  children,
}: {
  mono: Mono;
  model: AgentModel;
  values: Record<string, string>;
  source?: EffortSource;
  onReset(): void;
  children?: ReactNode;
}) {
  const desired = monoRoleEffort(mono.role);
  if (!desired) return children;
  const setting = modelEffortSetting(model);
  const supported = setting?.options.some(option => option.value === desired);
  const effort = setting ? values[setting.id] ?? setting.value : undefined;
  const suggest = supported && desired === "medium" && ["high", "xhigh", "max", "ultra"].includes(effort ?? "");
  return (
    <div className="flex min-w-0 flex-col items-start gap-1 pb-1" data-mono-role-effort>
      {children ?? <span className="py-1 text-xs">Provider default</span>}
      <span className="text-[11px] text-content/50">{source === "role" ? "Role default" : "Set by you"}</span>
      {(source !== "role" || suggest) && (
        <button type="button" onClick={onReset} className="rounded text-left text-[11px] text-accent hover:underline focus-visible:outline-accent">
          {suggest ? "Use role default (medium)" : "Reset to role default"}
        </button>
      )}
      {suggest && <span className="text-[11px] text-content/50">coordinators route and review; high effort mostly adds latency</span>}
      {!supported && <span className="text-[11px] text-content/50">This model does not support the {desired} role default; the provider default applies when reset.</span>}
    </div>
  );
}
