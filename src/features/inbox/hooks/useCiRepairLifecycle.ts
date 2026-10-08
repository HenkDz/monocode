import { useEffect, useRef, useSyncExternalStore } from "react";
import {
  getCiRepairs,
  settleCiRepair,
  stopCiRepairs,
  subscribeCiRepairs,
  type TrackedCiRepair,
} from "../model/ciRepairTracking";
import { fetchGithubPrChecks } from "../model/githubPrChecks";
import { monoManagerGoals } from "../../monos/model/monoManagerGoals";

/** Repairs must notice a PR closing even when its Inbox detail is no longer open. */
export function useCiRepairLifecycle(
  stop: (repair: TrackedCiRepair, state: "merged" | "closed") => Promise<void>,
) {
  const attempts = useSyncExternalStore(
    subscribeCiRepairs,
    getCiRepairs,
    getCiRepairs,
  );
  const goalRevision = useSyncExternalStore(
    monoManagerGoals.subscribe,
    monoManagerGoals.snapshot,
    monoManagerGoals.snapshot,
  );
  useEffect(() => {
    for (const attempt of attempts) {
      if (!attempt.goalId || attempt.phase === "not-needed") continue;
      const goal = monoManagerGoals
        .goals(attempt.goalOwnerId)
        .find((goal) => goal.id === attempt.goalId);
      if (goal?.state === "ready" || goal?.state === "done")
        settleCiRepair(attempt.id, "completed");
      else if (goal?.state === "cancelled")
        settleCiRepair(attempt.id, "cancelled");
    }
  }, [attempts, goalRevision]);
  const stopRef = useRef(stop);
  stopRef.current = stop;
  const targets = [
    ...new Map(
      attempts
        .filter((attempt) => {
          if (attempt.phase === "not-needed") return false;
          const goal =
            attempt.goalId &&
            monoManagerGoals
              .goals(attempt.goalOwnerId)
              .find((goal) => goal.id === attempt.goalId);
          if (goal && (goal.state === "done" || goal.state === "cancelled"))
            return false;
          return (
            attempt.phase === "running" ||
            attempt.phase === "interrupted" ||
            Boolean(attempt.goalId)
          );
        })
        .map((attempt) => [
          JSON.stringify([attempt.cwd, attempt.repo, attempt.number]),
          [attempt.cwd, attempt.repo, attempt.number] as const,
        ]),
    ).values(),
  ];
  const key = JSON.stringify(targets);
  useEffect(() => {
    const scoped: [string, string, number][] = JSON.parse(key);
    if (!scoped.length) return;
    let active = true;
    let polling = false;
    const poll = async () => {
      if (polling) return;
      polling = true;
      try {
        await Promise.all(
          scoped.map(async ([cwd, repo, number]) => {
            try {
              const checks = await fetchGithubPrChecks(cwd, repo, number);
              if (
                !active ||
                (checks.state !== "merged" && checks.state !== "closed")
              )
                return;
              const state = checks.state;
              await stopCiRepairs(cwd, repo, number, state, (attempt) =>
                stopRef.current(attempt, state),
              );
            } catch (error) {
              // Retain the repair and retry on the next refresh; failed reads do not cancel work.
              console.error("Could not refresh CI repair lifecycle", error);
            }
          }),
        );
      } finally {
        polling = false;
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 30_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [key]);
}
