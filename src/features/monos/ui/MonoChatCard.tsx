import { useEffect, useState, useSyncExternalStore } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  cardSession,
  openCardSession,
  subscribeCardSessions,
  type MonoCard,
} from "../model/monoCards";
import { monoManagerGoals } from "../model/monoManagerGoals";
import { findMono, monoLook } from "../model/mono";
import { orchestrator } from "../../orchestration/model/orchestration";
import { ReadyCard } from "../../orchestration/ui/ProjectManagerReview";
import {
  managerPrReady,
  taskPrStatus,
} from "../../orchestration/model/projectManager";
import { usePrStatusCache } from "../../source-control/hooks/usePrStatus";
import { pathKey } from "../../../shared/lib/paths";
import { PixelMascot } from "../../projects/ui/PixelMascot";

const button =
  "rounded px-2 py-1 text-xs hover:bg-content/10 focus-visible:outline-accent";
export function MonoChatCard({
  card,
  monoId,
  blockId,
}: {
  card: MonoCard;
  monoId: string;
  blockId: string;
}) {
  useSyncExternalStore(monoManagerGoals.subscribe, monoManagerGoals.snapshot);
  useSyncExternalStore(orchestrator.subscribe, orchestrator.snapshot);
  const statuses = usePrStatusCache();
  const [index, setIndex] = useState(0);
  const [, refresh] = useState(0);
  useEffect(
    () => subscribeCardSessions(() => refresh((value) => value + 1)),
    [],
  );
  useEffect(() => {
    void monoManagerGoals.hydrate(monoId).catch(console.error);
  }, [monoId]);
  const mono = findMono(monoId);
  const projects = mono ? monoLook(mono).projects : [];
  const goals = monoManagerGoals
    .goals(monoId)
    .filter(
      (goal) =>
        !goal.archived &&
        projects.some((project) => pathKey(project.path) === goal.projectId) &&
        (!("goalIds" in card) ||
          !card.goalIds ||
          card.goalIds.includes(goal.id)),
    );
  const reply = (text: string) =>
    window.dispatchEvent(
      new CustomEvent("monocode:mono-card-reply", { detail: { monoId, text } }),
    );
  if (
    card.type === "dispatch" &&
    (mono?.role !== "orchestrator" || !goals.length)
  )
    return null;
  if (card.type === "ready") {
    const ready = goals.flatMap((goal) => {
      const run = orchestrator.run(goal.managerId);
      return run
        ? run.tasks
            .filter(
              (task) =>
                task.monoGoalId === goal.id &&
                managerPrReady(task, taskPrStatus(task, statuses)),
            )
            .map((task) => ({ run, task }))
        : [];
    });
    const item = ready[index % Math.max(1, ready.length)];
    return item ? (
      <ReadyCard
        run={item.run}
        task={item.task}
        merged={false}
        onNext={() => setIndex((value) => (value + 1) % ready.length)}
      />
    ) : (
      <div className="rounded-xl border border-content/15 p-3 text-xs text-content/60">
        No PRs ready to review.
      </div>
    );
  }
  if (card.type === "dispatch" || card.type === "status")
    return (
      <section
        aria-label={
          card.type === "dispatch" ? "Delegated goals" : "Project status"
        }
        className="min-w-0 rounded-xl border border-content/15 p-3 font-sans text-xs"
      >
        <h3 className="mb-2 font-medium">
          {card.type === "dispatch"
            ? "Delegated to Managers"
            : "Project status"}{" "}
          <span className="text-content/60">· {goals.length}</span>
        </h3>
        {goals.length ? (
          goals.map((goal) => {
            const manager = findMono(goal.managerId),
              look = manager && monoLook(manager);
            return (
              <div
                key={goal.id}
                className="flex min-w-0 items-center gap-2 border-t border-content/8 py-2"
              >
                {look && (
                  <PixelMascot
                    name={look.mascot}
                    color={look.color}
                    still
                    className="size-4 shrink-0"
                  />
                )}
                <span
                  className="max-w-24 shrink truncate text-content/60"
                  title={goal.projectId}
                >
                  {
                    projects.find(
                      (project) => pathKey(project.path) === goal.projectId,
                    )?.name
                  }
                </span>
                <span className="min-w-0 flex-1 truncate" title={goal.title}>
                  {goal.title}
                </span>
                <span
                  className={`shrink-0 rounded px-1.5 py-0.5 ${goal.state === "ready" || goal.state === "done" ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" : goal.state === "needs-you" || goal.state === "blocked" ? "bg-amber-500/10 text-amber-700 dark:text-amber-400" : "bg-content/5 text-content/60"}`}
                >
                  {goal.state === "needs-you" ? "Needs you" : goal.state}
                </span>
                <button
                  type="button"
                  aria-label={`Open ${look?.name ?? "Manager"}: ${goal.title}`}
                  className={`${button} shrink-0 bg-content/8 font-medium`}
                  onClick={() => openCardSession(goal.managerId)}
                >
                  Open
                </button>
              </div>
            );
          })
        ) : (
          <p className="text-content/60">No delegated goals.</p>
        )}
      </section>
    );
  if (card.type === "session") {
    const session = cardSession(card.sessionId);
    return (
      <button
        type="button"
        className={`${button} block w-full border border-content/15 p-3 text-left`}
        onClick={() => openCardSession(card.sessionId)}
      >
        {session?.title ?? "Session"} ·{" "}
        {session?.needsInput ? "Needs you" : session?.busy ? "Running" : "Idle"}
        {card.note && <p>{card.note}</p>}
      </button>
    );
  }
  if (card.type === "pr")
    return (
      <button
        type="button"
        className={`${button} border border-content/15 p-3`}
        disabled={!card.repo}
        onClick={() =>
          void openUrl(
            `https://github.com/${card.repo}/pull/${card.number}`,
          ).catch(console.error)
        }
      >
        PR #{card.number}
        {card.note ? ` · ${card.note}` : ""}
      </button>
    );
  if (card.type === "choices")
    return (
      <div className="flex flex-wrap gap-2">
        {card.options.map((option) => (
          <button
            type="button"
            className={`${button} border border-content/15`}
            key={option}
            onClick={() => reply(option)}
          >
            {option}
          </button>
        ))}
      </div>
    );
  if (card.type === "habit")
    return (
      <section className="rounded-xl border border-content/15 p-3 text-xs">
        <h3>{card.name}</h3>
        <p className="my-2 text-content/60">{card.instructions}</p>
        <button
          type="button"
          className={button}
          onClick={() =>
            reply(`Create this habit I approve: ${JSON.stringify(card)}`)
          }
        >
          Start habit
        </button>
      </section>
    );
  return <span data-card={blockId} />;
}
