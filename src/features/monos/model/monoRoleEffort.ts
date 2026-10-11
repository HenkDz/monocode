import {
  isEffortSettingId,
  mergeModelSettings,
  modelEffortSetting,
  resolveModel,
  type AgentModel,
  type EffortSource,
} from "../../sessions/model/models";
import type { Mono } from "./mono";
import type { OrchestrationTask } from "../../orchestration/model/orchestrationState";

type EffortOwner = Pick<Mono, "role" | "effortSource" | "userLockedFields">;
export type MonoEffortResolution = {
  modelSettings: Record<string, string>;
  effortSource?: EffortSource;
};

export function monoRoleEffort(role: Mono["role"]): "medium" | "high" | undefined {
  return role === "member" ? "high" : role ? "medium" : undefined;
}

/** Resolve only advertised settings; generic chat preferences are not role choices. */
export function resolveMonoRoleEffort(
  mono: EffortOwner,
  model: AgentModel,
  settings?: Record<string, string>,
): MonoEffortResolution {
  const modelSettings = mergeModelSettings(model, settings);
  const desired = monoRoleEffort(mono.role);
  if (!desired) return { modelSettings, effortSource: mono.effortSource };
  const chosen = Object.keys(settings ?? {}).some(isEffortSettingId);
  if (mono.userLockedFields?.includes("modelSettings") || mono.effortSource === "user" || (chosen && mono.effortSource !== "role"))
    return { modelSettings, effortSource: mono.effortSource };
  const effort = modelEffortSetting(model);
  if (effort) modelSettings[effort.id] = effort.options.some(option => option.value === desired) ? desired : effort.value;
  return { modelSettings, effortSource: "role" };
}

/** A prepared task's source wins over later roster edits, including on retries. */
export function snapshotMonoWorkerEffort(
  task: Pick<OrchestrationTask, "harness" | "model" | "modelSettings" | "effortSource">,
  member?: Mono,
): Required<MonoEffortResolution> {
  if (task.effortSource && task.modelSettings) return { modelSettings: { ...task.modelSettings }, effortSource: task.effortSource };
  const chosen = Object.keys(task.modelSettings ?? {}).some(isEffortSettingId);
  const owner: EffortOwner = { ...member, role: "member", effortSource: chosen ? undefined : task.effortSource ?? member?.effortSource };
  const effective = resolveMonoRoleEffort(owner, resolveModel(task.harness, task.model), task.modelSettings);
  return { modelSettings: effective.modelSettings, effortSource: effective.effortSource ?? "user" };
}

/** Explicit effort follows a user-selected model when its setting ID changes. */
export function switchMonoRoleEffort(
  mono: EffortOwner,
  previous: AgentModel,
  model: AgentModel,
  settings: Record<string, string>,
): MonoEffortResolution {
  const from = modelEffortSetting(previous);
  const to = modelEffortSetting(model);
  const current = { ...settings };
  if (from && to && Object.prototype.hasOwnProperty.call(settings, from.id))
    current[to.id] = settings[from.id];
  return resolveMonoRoleEffort(mono, model, current);
}

export function resetMonoRoleEffort(mono: EffortOwner, model: AgentModel, settings?: Record<string, string>) {
  const retained = Object.fromEntries(Object.entries(settings ?? {}).filter(([id]) => !isEffortSettingId(id)));
  const userLockedFields = (mono.userLockedFields ?? []).filter(field => field !== "modelSettings");
  return {
    ...resolveMonoRoleEffort({ ...mono, effortSource: "role", userLockedFields }, model, retained),
    effortSource: "role" as const,
    userLockedFields,
  };
}
