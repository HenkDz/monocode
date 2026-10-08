import { useSyncExternalStore } from "react";
import type { Mono } from "../model/mono";
import {
  crewMessages,
  crewMessagesSnapshot,
  subscribeCrewMessages,
} from "../model/monoCrewEvents";
import { monoLook, monoState, MONO_STATUS_LABEL } from "../model/mono";
import { monoLiveState, memberTasks } from "../model/monoNavigation";
import {
  activityTaskEvent,
  activityTaskTitle,
  activityToolTitle,
  orgDescendants,
} from "../model/monoTeamActivity";
import type { OrchestrationRun } from "../../orchestration/model/orchestrationState";
import type { Session } from "../../sessions/model/session";
import { formatLiveElapsed } from "../../sessions/model/liveAgents";
import { PixelMascot } from "../../projects/ui/PixelMascot";
import { openCardSession } from "../model/monoCards";
import { managerTaskLifecycle, taskPrStatus } from "../../orchestration/model/projectManager";
import { usePrStatusCache } from "../../source-control/hooks/usePrStatus";
import type { GitPr } from "../../../platform/tauri/fs";
import { ArtifactText } from "../../artifacts/ui/ArtifactReference";

export function crewFeed(
  roster: readonly Mono[],
  runs: readonly OrchestrationRun[],
  statuses: ReadonlyMap<string, GitPr | null> = new Map(),
  sessions: readonly Session[] = [],
) {
  const events = runs.flatMap((run) =>
    run.tasks.flatMap((task) => {
      const name =
        roster.find((m) => m.id === task.memberId)?.name ??
        task.memberName ??
        "Worker";
      const title = activityTaskTitle(task);
      const session = sessions.find(entry => entry.id === task.sessionId);
      const needsInput = !!session && monoState(session).status === "needs-you";
      const dispatches = (run.dispatches ?? []).filter(
        (d) => d.taskId === task.id,
      );
      return dispatches
        .flatMap((d) => [
          {
            id: `${d.id}:start`,
            at: d.startedAt,
            memberId: task.memberId,
            text: `${name} picked up ${title}`,
          },
          ...([
            "completed",
            "failed",
            "blocked",
            "interrupted",
            "cancelled",
          ].includes(d.state)
            ? [
                {
                  id: `${d.id}:end`,
                  at: d.updatedAt,
                  memberId: task.memberId,
                  text: `${name} · ${managerTaskLifecycle(task, taskPrStatus(task, statuses), needsInput)[0]} · ${title}`,
                },
              ]
            : []),
        ])
        .concat(
          task.handoffNote && dispatches.length
            ? [
                {
                  id: `${task.id}:handoff`,
                  at: Math.min(...dispatches.map((d) => d.startedAt)),
                  memberId: task.memberId,
                  text: `${name} received a hand-off · ${task.handoffNote.split(/\r?\n/).filter(Boolean).join(" · ")}`,
                },
              ]
            : [],
          task.reviewVerdict && dispatches.length
            ? [
                {
                  id: `${task.id}:review:${task.reviewVerdict.dispatchId}`,
                  at: Math.max(...dispatches.map((d) => d.updatedAt)),
                  memberId: task.memberId,
                  text: `${name} ${task.reviewVerdict.decision === "approve" ? "approved" : "requested changes to"} ${title}`,
                },
              ]
            : [],
          task.prReadyAt
            ? [
                {
                  id: `${task.id}:pr`,
                  at: task.prReadyAt,
                  memberId: task.memberId,
                  text: `PR ready · ${title}`,
                },
              ]
            : [],
        );
    }),
  );
  return [...new Map(events.map((event) => [event.id, event])).values()].sort(
    (a, b) => a.at - b.at || a.id.localeCompare(b.id),
  );
}

export function MonoOrgActivity({
  rootId,
  roster,
  runs,
  sessions,
  now,
}: {
  rootId: string;
  roster: readonly Mono[];
  runs: readonly OrchestrationRun[];
  sessions: readonly Session[];
  now: number;
}) {
  useSyncExternalStore(subscribeCrewMessages, crewMessagesSnapshot);
  const statuses = usePrStatusCache();
  const availability = (mono: Mono) => monoLiveState(roster, runs, sessions, mono.id).status;
  const node = (mono: Mono) => {
    const tasks = [
      ...new Map(
        memberTasks(runs, mono.id).map((task) => [task.id, task]),
      ).values(),
    ];
    const current = tasks.find((t) =>
      ["running", "queued", "cancelling"].includes(t.status),
    );
    const session = sessions.find((s) => s.id === current?.sessionId);
    const status = availability(mono);
    const look = monoLook(mono);
    const children = roster.filter(
      (m) => m.reportsTo === mono.id && !m.archivedAt,
    );
    const start = runs
      .flatMap((r) => r.dispatches ?? [])
      .find(
        (d) => d.id === (current?.activeDispatchId ?? current?.lastDispatchId),
      )?.startedAt;
    return (
      <div key={mono.id} data-org-member={mono.id} className="space-y-2">
        <div className="flex gap-2 text-xs">
          <PixelMascot
            name={look.mascot}
            color={look.color}
            status={status}
            className="size-7 shrink-0"
          />
          <div className="min-w-0 flex-1">
            <div className="flex gap-2">
              <button type="button" className="truncate rounded font-medium hover:underline focus-visible:outline-accent" onClick={() => window.dispatchEvent(new CustomEvent("monocode:open-team", { detail: { monoId: mono.id } }))}>{look.name}</button>
              <span className="ml-auto shrink-0 text-content/45">
                {MONO_STATUS_LABEL[status]}
                {start !== undefined
                  ? ` · ${formatLiveElapsed(start, now)}`
                  : ""}
              </span>
            </div>
            <p className="truncate text-content/65">
              {current
                ? activityTaskTitle(current)
                : children.length
                  ? `${children.length} teammates · ${children.filter((child) => availability(child) === "working").length} working`
                  : status === "working"
                    ? "Coordinating project work"
                    : "Ready for the next task"}
            </p>
            {current && (
              <p className="truncate text-content/45">
                Now doing: <ArtifactText text={activityTaskEvent(current, session)} monoId={mono.id} />
              </p>
            )}
            {tasks.length > 0 && (
              <details className="mt-1">
                <summary className="cursor-pointer text-content/50">
                  Tasks ({tasks.length})
                </summary>
                <div className="space-y-1 pt-1">
                  {tasks.slice(0, 8).map((task) => (
                    <button
                      key={task.id}
                      className="block w-full truncate text-left text-content/60 hover:underline"
                      onClick={() => openCardSession(task.sessionId)}
                    >
                      {activityTaskTitle(task)} · {managerTaskLifecycle(task, taskPrStatus(task, statuses), sessions.some(session => session.id === task.sessionId && monoState(session).status === "needs-you"))[0]}
                    </button>
                  ))}
                </div>
              </details>
            )}
            {current && session && (
              <details className="mt-1" open={mono.id === rootId}>
                <summary className="cursor-pointer text-content/50">
                  Live activity
                </summary>
                <ol className="space-y-1 pt-1">
                  {session.blocks
                    .filter((b) => !b.internal && b.tool?.title)
                    .slice(-8)
                    .map((b) => (
                      <li key={b.id} className="truncate text-content/60">
                        {activityToolTitle(b.tool!.title!)}
                      </li>
                    ))}
                </ol>
              </details>
            )}
          </div>
        </div>
        {children.length > 0 && (
          <div className="ml-3 space-y-3 border-l border-stroke pl-3">
            {children.map(node)}
          </div>
        )}
      </div>
    );
  };
  const root = roster.find((m) => m.id === rootId);
  const managerIds = new Set(runs.map((run) => run.ownerMonoId));
  if (root?.role === "manager") managerIds.add(root.id);
  if (root?.role === "member") managerIds.add(root.reportsTo);
  for (const mono of roster)
    if (mono.role === "manager" && orgDescendants(roster, rootId).has(mono.id))
      managerIds.add(mono.id);
  const feed = [
    ...crewFeed(roster, runs, statuses, sessions),
    ...crewMessages()
      .filter((event) => managerIds.has(event.managerId))
      .map((event) => ({
        id: event.id,
        at: event.at,
        memberId: event.senderId,
        text:
          event.summary ??
          `${roster.find((m) => m.id === event.senderId)?.name ?? "Teammate"} asked ${roster.find((m) => m.id === event.recipientId)?.name ?? "a teammate"} · ${event.topic}: ${event.text}`,
      })),
  ]
    .sort((a, b) => a.at - b.at || a.id.localeCompare(b.id))
    .slice(-40);
  return (
    <section data-org-view className="space-y-3">
      <h3 className="text-xs font-medium">Team at work</h3>
      {root && node(root)}
      <details data-crew-feed>
        <summary className="cursor-pointer text-xs text-content/60">
          Crew feed ({feed.length})
        </summary>
        <ol className="mt-2 space-y-2">
          {feed.map((event) => {
            const mono = roster.find((m) => m.id === event.memberId);
            return (
              <li key={event.id} className="flex gap-2 text-xs text-content/60">
                {mono && (
                  <PixelMascot
                    name={mono.mascot}
                    color={mono.color}
                    still
                    className="size-4 shrink-0"
                  />
                )}
                <span className="line-clamp-2 break-words">
                  <ArtifactText text={event.text} monoId={event.memberId} />
                </span>
              </li>
            );
          })}
        </ol>
        {!feed.length && (
          <p className="mt-2 text-xs text-content/45">
            Team events will appear here as work starts.
          </p>
        )}
      </details>
    </section>
  );
}
