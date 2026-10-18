import { useEffect, useRef } from "react";
import {
  gitPrStatusBatch,
  subscribeGitChanged,
} from "../../../platform/tauri/fs";
import type { Session } from "../../sessions/model/session";
import type {
  OrchestrationRun,
  OrchestrationTask,
} from "../../orchestration/model/orchestrationState";
import {
  markPullRequestUnavailable,
  pullRequests,
  recordPullRequest,
  sessionPrCandidates,
  usePullRequests,
  type PrLink,
  prIdentity,
  setTaskPrAcceptance,
} from "../model/pullRequests";
import { pathKey } from "../../../shared/lib/paths";
import { githubPollingAllowed, noteGithubError, refreshGithubBudget } from "../../inbox/model/githubBudget";

function taskAcceptanceHead(task: OrchestrationTask): string | null {
  return task.status === "completed" &&
    task.accepted &&
    !!task.lastDispatchId &&
    task.acceptedDispatchId === task.lastDispatchId &&
    (!task.delivery || task.delivery.state === "ready")
    ? (task.reviewedHead ?? task.delivery?.head ?? null)
    : null;
}

/** Runs for all loaded sessions, including background workers and ordinary chats. */
export function useSessionPullRequests(
  sessions: readonly Session[],
  runs: readonly OrchestrationRun[],
) {
  const current = useRef({ sessions, runs });
  current.current = { sessions, runs };
  const inFlight = useRef(new Set<string>());
  const attempted = useRef(new Map<string, number>());
  const refresh = useRef<(force?: boolean) => void>(() => {});
  refresh.current = (force = false) => {
    if (!githubPollingAllowed()) return;
    const candidates = current.current.sessions
      .filter((s) => !s.ephemeral && !s.inboxAsk)
      .flatMap(sessionPrCandidates);
    for (const candidate of candidates) {
      const original = pullRequests().find(
        (entry) =>
          prIdentity(entry.pr.url) === prIdentity(candidate.url) &&
          entry.links.some(
            (link) => link.sessionId === candidate.link.sessionId,
          ),
      );
      if (original) candidate.cwd = original.cwd;
      const run = current.current.runs.find((run) =>
        run.tasks.some(
          (task) =>
            task.sessionId === candidate.link.sessionId ||
            (task.prUrl &&
              prIdentity(task.prUrl) === prIdentity(candidate.url)),
        ),
      );
      const task = run?.tasks.find(
        (task) =>
          task.sessionId === candidate.link.sessionId ||
          (task.prUrl && prIdentity(task.prUrl) === prIdentity(candidate.url)),
      );
      if (task && run) {
        candidate.link.taskId = task.id;
        const ownerId = run.ownerSessionId ?? run.leadId;
        if (candidate.link.sessionId !== ownerId) {
          const owner = current.current.sessions.find((s) => s.id === ownerId);
          candidates.push({
            ...candidate,
            link: {
              ...candidate.link,
              sessionId: ownerId,
              sessionTitle: owner?.title ?? task.title,
              turnId:
                owner?.blocks
                  .filter(
                    (b) =>
                      b.role === "user" &&
                      (b.startedAt ?? 0) <= candidate.link.at,
                  )
                  .slice(-1)[0]?.id ??
                task.prReadyTurnId ??
                "",
            },
          });
        }
      }
    }
    for (const run of current.current.runs)
      for (const task of run.tasks) {
        if (!task.prUrl) {
          for (const entry of pullRequests())
            if (
              entry.links.some(
                (link) => link.taskId === task.id && link.acceptedHead,
              )
            )
              setTaskPrAcceptance(task.id, entry.pr.url, null);
          continue;
        }
        if (!task.workspace) continue;
        const acceptedHead = taskAcceptanceHead(task);
        setTaskPrAcceptance(task.id, task.prUrl, acceptedHead);
        for (const sessionId of new Set([
          run.ownerSessionId ?? run.leadId,
          task.sessionId,
        ])) {
          const session = current.current.sessions.find(
            (s) => s.id === sessionId,
          );
          candidates.push({
            url: task.prUrl,
            cwd: task.workspace.checkoutCwd,
            link: {
              sessionId,
              sessionTitle: session?.title ?? task.title,
              turnId:
                (sessionId === task.sessionId
                  ? undefined
                  : task.prReadyTurnId) ??
                session?.blocks.filter((b) => b.role === "user").slice(-1)[0]
                  ?.id ??
                "",
              blockId: task.id,
              at: task.prReadyAt ?? Date.now(),
              taskId: task.id,
              acceptedHead,
            },
          });
        }
      }
    const grouped = new Map<
      string,
      { cwd: string; url: string; links: PrLink[] }
    >();
    for (const candidate of candidates) {
      const key = `${pathKey(candidate.cwd)}\n${prIdentity(candidate.url)}`;
      const group = grouped.get(key) ?? {
        cwd: candidate.cwd,
        url: candidate.url,
        links: [],
      };
      group.links.push(candidate.link);
      grouped.set(key, group);
    }
    // Retain history, but only open PRs need revalidation.
    for (const entry of pullRequests()) {
      const key = `${pathKey(entry.cwd)}\n${prIdentity(entry.pr.url)}`;
      if (!grouped.has(key))
        grouped.set(key, { cwd: entry.cwd, url: entry.pr.url, links: [] });
    }
    const batches = new Map<string, Promise<import("../../../platform/tauri/fs").GitPr[]>>();
    for (const [key, { cwd, url, links }] of grouped) {
      const known = pullRequests().find(
        (entry) =>
          pathKey(entry.cwd) === pathKey(cwd) &&
          prIdentity(entry.pr.url) === prIdentity(url),
      );
      const newLink = links.some(
        (link) =>
          !known?.links.some(
            (old) =>
              old.sessionId === link.sessionId && old.taskId === link.taskId,
          ),
      );
      if (known && known.pr.state !== "open") {
        if (newLink) for (const link of links) recordPullRequest(cwd, known.pr, link);
        continue;
      }
      if (
        inFlight.current.has(key) ||
        (!force &&
          !newLink &&
          Date.now() - (attempted.current.get(key) ?? 0) < 30_000)
      )
        continue;
      // Retry unverified output at most once per poll, even while text streams.
      if (
        !force &&
        !known &&
        Date.now() - (attempted.current.get(key) ?? 0) < 30_000
      )
        continue;
      inFlight.current.add(key);
      attempted.current.set(key, Date.now());
      const batchKey = pathKey(cwd);
      let batch = batches.get(batchKey);
      if (!batch) {
        const urls = [...grouped.values()]
          .filter(candidate => pathKey(candidate.cwd) === batchKey &&
            !pullRequests().some(entry => prIdentity(entry.pr.url) === prIdentity(candidate.url) && entry.pr.state !== "open"))
          .map(candidate => candidate.url);
        batch = gitPrStatusBatch(cwd, urls);
        batches.set(batchKey, batch);
      }
      void batch.then(prs => prs.find(pr => prIdentity(pr.url) === prIdentity(url)) ?? null)
        .then((pr) => {
          if (!pr || prIdentity(pr.url) !== prIdentity(url)) {
            markPullRequestUnavailable(cwd, url);
            return;
          }
          if (!links.length) recordPullRequest(cwd, pr);
          else for (const link of links) recordPullRequest(cwd, pr, link);
          for (const task of current.current.runs.flatMap((run) => run.tasks)) {
            if (
              links.some((link) => link.taskId === task.id) &&
              (!task.prUrl || prIdentity(task.prUrl) === prIdentity(url))
            )
              setTaskPrAcceptance(
                task.id,
                url,
                task.prUrl ? taskAcceptanceHead(task) : null,
              );
          }
        })
        .catch(reason => {
          if (noteGithubError(reason, cwd) === (reason instanceof Error ? reason.message : String(reason)))
            markPullRequestUnavailable(cwd, url);
        })
        .finally(() => { inFlight.current.delete(key); void refreshGithubBudget(); });
    }
  };
  useEffect(() => {
    refresh.current();
  }, [sessions, runs]);
  useEffect(() => {
    const resume = () => {
      if (!document.hidden) refresh.current(true);
    };
    const timer = window.setInterval(resume, 30_000);
    const unsubscribe = subscribeGitChanged(resume);
    window.addEventListener("focus", resume);
    document.addEventListener("visibilitychange", resume);
    return () => {
      clearInterval(timer);
      unsubscribe();
      window.removeEventListener("focus", resume);
      document.removeEventListener("visibilitychange", resume);
    };
  }, []);
  return usePullRequests();
}
