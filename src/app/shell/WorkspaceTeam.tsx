import { AgentStatusLabel } from "../../features/agents/ui/AgentStatusLabel";
import { AgentDetailTooltip } from "../../features/agents/ui/AgentDetailTooltip";
import {
  dedicatedMono,
  monoLook,
  monoLiveStatusLabel,
  monoTeamWorkingLabel,
  monoWorksOn,
  type Mono,
  type MonoState,
} from "../../features/monos/model/mono";
import { MonoRailMascot } from "../../features/monos/ui/MonoRailMascot";
import type { MonoRailProps } from "./MonoRailSection";
import { Plus } from "../../shared/ui/icons";

export function workspaceTeam(roster: readonly Mono[], project: string) {
  const active = roster.filter((mono) => mono.archivedAt == null);
  const manager = dedicatedMono(project, active);
  return {
    bosses: active.filter((mono) => mono.role === "orchestrator"),
    manager,
    members: manager
      ? active.filter(
          (mono) => mono.role === "member" && mono.reportsTo === manager.id,
        )
      : [],
  };
}

export function WorkspaceTeam({
  roster,
  project,
  ...props
}: MonoRailProps & { roster: readonly Mono[]; project: string }) {
  const { bosses, manager, members } = workspaceTeam(roster, project);
  const standalone = roster.filter(
    (mono) =>
      !mono.role && mono.archivedAt == null && monoWorksOn(mono, project),
  );
  const row = (mono: Mono, role?: string) => {
    const look = monoLook(mono);
    const state: MonoState = props.states.get(mono.id) ?? { status: "idle" };
    const label = monoLiveStatusLabel(state);
    const nextAction = props.nextAction?.(mono.id);
    const unread =
      mono.id === props.activeId ? 0 : (props.unseenCounts?.get(mono.id) ?? 0);
    const detail = [
      look.name,
      role,
      label,
      state.liveState?.detail,
      state.liveState?.warning,
      monoTeamWorkingLabel(state),
    ]
      .filter(Boolean)
      .join("\n");
    return (
      <Fragment key={mono.id}><AgentDetailTooltip detail={detail}>
        <button
          type="button"
          data-sidebar-row
          data-workspace-mono={mono.id}
          data-mono-status={state.status}
          aria-current={mono.id === props.activeId ? "page" : undefined}
          aria-label={`${look.name}, ${role ?? "Member"}, ${label}${unread ? `, ${unread} new replies` : ""}`}
          title={detail}
          onClick={() => props.onOpen(mono.id)}
          className={`flex min-h-12 w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-content/5 focus-visible:outline-accent ${mono.id === props.activeId ? "bg-selection text-content" : "text-content/80"}`}
        >
          <MonoRailMascot
            name={look.mascot}
            color={look.color}
            status={state.status}
          />
          <span className="min-w-0 flex-1">
            <span className="flex items-baseline gap-1.5 text-[12px] font-medium">
              <span className="truncate">{look.name}</span>
              {role && (
                <small className="shrink-0 text-[10px] font-normal text-content/45">
                  {role}
                </small>
              )}
            </span>
            <span className="mt-0.5 block truncate text-[11px] text-content/60">
              {nextAction && state.liveState?.reason === "held-updates" ? null : state.liveState && !state.attentionLocation ? (
                <AgentStatusLabel state={state.liveState} />
              ) : (
                label
              )}
              {state.teamWorking ? ` · ${monoTeamWorkingLabel(state)}` : ""}
            </span>
          </span>
          {unread > 0 && (
            <span className="text-[10px] tabular-nums text-accent">
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </button>
      </AgentDetailTooltip>{nextAction}</Fragment>
    );
  };
  return (
    <section aria-label="Team" className="px-2 pb-3" data-workspace-team>
      <div className="flex h-7 items-center px-2 text-[11px] font-medium uppercase tracking-wide text-content/45">
        <h2 className="flex-1">Team</h2>
        <button
          type="button"
          title="New mono"
          aria-label="New mono"
          onClick={() => props.onCreate([project])}
          className="grid size-5 place-items-center rounded hover:bg-content/10"
        >
          <Plus className="size-3.5" />
        </button>
      </div>
      {bosses.map((mono) => row(mono, "Boss · all projects"))}
      {manager ? (
        row(manager, "Manager")
      ) : (
        <p className="px-2 py-2 text-[11px] text-content/50">
          No Manager assigned to this project.
        </p>
      )}
      {members.length > 0 && (
        <div className="ml-4 border-l border-stroke pl-1">
          {members.map((mono) => row(mono))}
        </div>
      )}
      {!bosses.length && (
        <p className="px-2 py-1 text-[11px] text-content/50">
          No Boss configured yet.
        </p>
      )}
      {standalone.length > 0 && (
        <>
          <h2 className="px-2 pb-1 pt-3 text-[11px] font-medium text-content/45">
            Monos
          </h2>
          {standalone.map((mono) => row(mono, "Mono"))}
        </>
      )}
    </section>
  );
}
import { Fragment } from "react";
