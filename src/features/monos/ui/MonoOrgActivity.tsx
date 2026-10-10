import { useState, useSyncExternalStore } from "react";
import { Modal } from "../../../shared/ui/Modal";
import { MonoActivityContent } from "./MonoActivityPanel";
import type { Mono } from "../model/mono";
import {
  crewMessages,
  crewMessagesSnapshot,
  subscribeCrewMessages,
} from "../model/monoCrewEvents";
import { monoLook, monoState, monoStatusLabel, monoTeamWorkingLabel } from "../model/mono";
import { monoLiveState, memberTasks } from "../model/monoNavigation";
import { activityTaskTitle, orgDescendants } from "../model/monoTeamActivity";
import type { OrchestrationRun } from "../../orchestration/model/orchestrationState";
import type { Session } from "../../sessions/model/session";
import { formatLiveElapsed } from "../../sessions/model/liveAgents";
import { PixelMascot } from "../../projects/ui/PixelMascot";
import {
  managerTaskFinished,
  managerTaskLifecycle,
  taskPrStatus,
} from "../../orchestration/model/projectManager";
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
      const session = sessions.find((entry) => entry.id === task.sessionId);
      const needsInput = !!session && monoState(session).status === "needs-you";
      const dispatches = (run.dispatches ?? []).filter(
        (d) => d.taskId === task.id,
      );
      const pr = taskPrStatus(task, statuses);
      const finished = managerTaskFinished(task, pr);
      const closedAt = pr && pr.url === task.prUrl && ["closed", "merged"].includes(pr.state)
        ? Date.parse(pr.closedAt ?? "")
        : NaN;
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
          finished && dispatches.length
            ? [{
                id: `${task.id}:finished`,
                // ponytail: legacy snapshots without lifecycle times use dispatch evidence; upgrade when all providers retain timestamps.
                at: Number.isFinite(closedAt) ? closedAt : task.acceptedAt ?? Math.max(...dispatches.map((d) => d.updatedAt)),
                memberId: task.memberId,
                text: `${name} · ${task.completionOutcome?.startsWith("no-changes") ? "Accepted (no changes)" : managerTaskLifecycle(task, taskPrStatus(task, statuses))[0]} · ${title}`,
              }]
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
  view = "all",
  onApproval,
}: {
  rootId: string;
  roster: readonly Mono[];
  runs: readonly OrchestrationRun[];
  sessions: readonly Session[];
  now: number;
  view?: "all" | "team" | "feed";
  onApproval?: (
    id: string,
    requestId: number,
    decision: "allow" | "deny",
  ) => void;
}) {
  useSyncExternalStore(subscribeCrewMessages, crewMessagesSnapshot);
  const statuses = usePrStatusCache();
  const [workSession, setWorkSession] = useState<string>();
  const node = (mono: Mono) => {
    const tasks = [
      ...new Map(
        memberTasks(runs, mono.id).map((task) => [task.id, task]),
      ).values(),
    ];
    const current = tasks.find((t) =>
      ["running", "queued", "cancelling"].includes(t.status),
    );
    const selectedTask = current ?? tasks[0];
    const session = sessions.find((s) => s.id === selectedTask?.sessionId);
    const state = monoLiveState(roster, runs, sessions, mono.id);
    const status = state.status;
    const look = monoLook(mono);
    const taskLabel = selectedTask
      ? managerTaskLifecycle(
          selectedTask,
          taskPrStatus(selectedTask, statuses),
          !!session && monoState(session).status === "needs-you",
        )[0]
      : "";
    const children = roster.filter(
      (m) => m.reportsTo === mono.id && !m.archivedAt,
    );
    const start = runs
      .flatMap((r) => r.dispatches ?? [])
      .find(
        (d) => d.id === (current?.activeDispatchId ?? current?.lastDispatchId),
      )?.startedAt;
    return (
      <div key={mono.id} data-org-member={mono.id} className="py-2">
        <div className="flex gap-2 text-xs">
          <PixelMascot
            name={look.mascot}
            color={look.color}
            status={status}
            className="size-7 shrink-0"
          />
          <div className="min-w-0 flex-1">
            <div className="flex gap-2">
              <button
                type="button"
                title={look.name}
                className="truncate rounded font-medium hover:underline focus-visible:outline-accent"
                onClick={() =>
                  window.dispatchEvent(
                    new CustomEvent("monocode:open-team", {
                      detail: { monoId: mono.id },
                    }),
                  )
                }
              >
                {look.name}
              </button>
              <span className="ml-auto shrink-0 text-content/60">
                {monoStatusLabel(state)}
                {state.teamWorking ? ` · ${monoTeamWorkingLabel(state)}` : ""}
                {start !== undefined
                  ? ` · ${formatLiveElapsed(start, now)}`
                  : ""}
              </span>
            </div>
            <div className="mt-1 flex min-w-0 items-center gap-2 text-content/60">
              <span
                title={
                  selectedTask ? activityTaskTitle(selectedTask) : undefined
                }
                className="min-w-0 flex-1 truncate"
              >
                {selectedTask
                  ? activityTaskTitle(selectedTask)
                  : children.length
                    ? `${children.length} teammates · ${state.teamWorking ?? 0} working below`
                    : status === "needs-you"
                      ? "Waiting for your decision"
                      : status === "working"
                        ? "Coordinating project work"
                        : "Ready for the next task"}
              </span>
              {selectedTask && (
                <span
                  title={`${tasks.length} tasks · ${taskLabel}`}
                  className="max-w-28 shrink-0 truncate"
                >
                  {taskLabel}
                </span>
              )}
              {selectedTask && session && (
                <button
                  type="button"
                  aria-label={`Show work for ${look.name}`}
                  className="shrink-0 rounded hover:underline focus-visible:outline-accent"
                  onClick={() => setWorkSession(session.id)}
                >
                  Show work
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  };
  const feed = orgCrewFeed(rootId, roster, runs, statuses, sessions);
  return (
    <section data-org-view className="space-y-3">
      {view !== "feed" && (
        <>
          <h3 className="text-xs font-medium">Team at work</h3>
          <div className="divide-y divide-stroke">
            {roster
              .filter(
                (mono) =>
                  !mono.archivedAt &&
                  orgDescendants(roster, rootId).has(mono.id),
              )
              .map(node)}
          </div>
        </>
      )}
      {view !== "team" && (
        <section data-crew-feed aria-label="Crew feed">
          <h3 className="text-xs font-medium text-content/60">
            Crew feed ({feed.length})
          </h3>
          <ol className="mt-2 space-y-2">
            {feed.map((event) => {
              const mono = roster.find((m) => m.id === event.memberId);
              return (
                <li
                  key={event.id}
                  className="flex gap-2 text-xs text-content/60"
                >
                  {mono && (
                    <PixelMascot
                      name={mono.mascot}
                      color={mono.color}
                      still
                      className="size-4 shrink-0"
                    />
                  )}
                  <span title={event.text} className="min-w-0 flex-1 truncate">
                    <ArtifactText text={event.text} monoId={event.memberId} />
                  </span>
                </li>
              );
            })}
          </ol>
          {!feed.length && (
            <p className="mt-2 text-xs text-content/60">
              Team events will appear here as work starts.
            </p>
          )}
        </section>
      )}
      {workSession && (
        <Modal
          title="Show work"
          onClose={() => setWorkSession(undefined)}
          fitViewport
        >
          <div
            onClickCapture={(event) => {
              if (
                event.target instanceof Element &&
                event.target.closest("[data-org-artifact]")
              )
                setWorkSession(undefined);
            }}
          >
            <MonoActivityContent
              readOutput
              cwd={sessions.find((session) => session.id === workSession)?.cwd}
              onApproval={(requestId, decision) =>
                onApproval?.(workSession, requestId, decision)
              }
              blocks={
                sessions.find((session) => session.id === workSession)
                  ?.blocks ?? []
              }
              live={
                !!sessions.find((session) => session.id === workSession)?.busy
              }
            />
          </div>
        </Modal>
      )}
    </section>
  );
}

export function orgCrewFeed(
  rootId: string,
  roster: readonly Mono[],
  runs: readonly OrchestrationRun[],
  statuses: ReadonlyMap<string, GitPr | null>,
  sessions: readonly Session[],
) {
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
  return feed;
}
