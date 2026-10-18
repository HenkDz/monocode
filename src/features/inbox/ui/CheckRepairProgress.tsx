import { useEffect, useId, useState, useSyncExternalStore } from "react";
import {
  getCiRepairs,
  subscribeCiRepairs,
  stopCiRepairs,
  type TrackedCiRepair,
} from "../model/ciRepairTracking";
import { sameProjectPath } from "../../projects/model/recents";
import {
  CheckCircle,
  ChevronRight,
  CircleDashed,
  CircleX,
  LoaderCircle,
  MessageSquare,
  type IconComponent,
} from "../../../shared/ui/icons";
import type { CheckRepair } from "./CheckRepairForm";
import type { GithubPrChecksView } from "../hooks/useGithubPrChecks";
import type {
  GithubPrCheck,
  GithubPrChecks,
  GithubPrCheckState,
} from "../model/githubPrChecks";
import {
  githubActionsJobId,
  githubCheckIdentity,
  latestPrChecks,
} from "../model/githubPrChecks";

type RepairState =
  | GithubPrCheckState
  | "repairing"
  | "waiting"
  | "stale"
  | "refreshing"
  | "stopped"
  | "interrupted"
  | "not-needed-merged"
  | "not-needed-closed"
  | "agent-error";
type RepairItem = {
  attempt: TrackedCiRepair;
  check: TrackedCiRepair["checks"][number];
  state: RepairState;
};
export type RepairGroup = { sessionId: string; items: RepairItem[] };

function repairCheckMatches(
  tracked: RepairItem["check"],
  current: GithubPrCheck,
): boolean {
  // App metadata may first arrive with a rerun; callers require a unique match.
  return (
    githubCheckIdentity(tracked) ===
    githubCheckIdentity({ ...current, app: tracked.app ? current.app : "" })
  );
}

export function findCheckRepair(
  groups: RepairGroup[],
  check: GithubPrCheck,
  current: GithubPrChecks,
): RepairItem | undefined {
  const candidates = groups
    .flatMap((group) => group.items)
    .filter((item) => repairCheckMatches(item.check, check));
  const exact = candidates.find(
    (item) =>
      item.attempt.headOid === current.headOid && item.check.url === check.url,
  );
  if (exact) return exact;
  // A rerun or commit changes job URLs. Match by name only when both sides are unique.
  if (candidates.length !== 1) return undefined;
  return latestPrChecks(current.checks).filter((item) =>
    repairCheckMatches(candidates[0].check, item),
  ).length === 1
    ? candidates[0]
    : undefined;
}

function repairState(
  attempt: TrackedCiRepair,
  check: RepairItem["check"],
  view: GithubPrChecksView,
  ambiguous: boolean,
  state?: string,
): RepairState {
  const terminal = state?.toLowerCase();
  if (terminal === "merged" || terminal === "closed")
    return `not-needed-${terminal}`;
  if (attempt.phase === "not-needed")
    return attempt.notNeeded === "merged"
      ? "not-needed-merged"
      : "not-needed-closed";
  if (attempt.phase === "running") return "repairing";
  if (attempt.phase === "failed") return "agent-error";
  if (attempt.phase === "cancelled") return "stopped";
  if (attempt.phase === "interrupted") return "interrupted";
  if (view.stale || view.error) return "stale";
  if (view.loading || view.refreshing) return "refreshing";
  const current = view.checks;
  if (!current || ambiguous) return "waiting";
  const matches = latestPrChecks(current.checks).filter((item) =>
    repairCheckMatches(check, item),
  );
  const originals = attempt.checks.filter(
    (item) => githubCheckIdentity(item) === githubCheckIdentity(check),
  );
  if (matches.length !== 1 || originals.length !== 1) return "waiting";
  const latest = matches[0];
  // Only a distinct, newer job can verify a completed repair attempt.
  if (
    (githubActionsJobId(check.url, attempt.repo) && latest.url === check.url) ||
    !latest.startedAt ||
    !Number.isFinite(Date.parse(latest.startedAt)) ||
    Date.parse(latest.startedAt) < attempt.startedAt
  )
    return "waiting";
  return latest.state;
}

export function useCheckRepairs(
  cwd: string,
  repo: string,
  number: number | undefined,
  view: GithubPrChecksView,
  state?: string,
): RepairGroup[] {
  const attempts = useSyncExternalStore(
    subscribeCiRepairs,
    getCiRepairs,
    getCiRepairs,
  );
  const seen = new Map<string, { headOid: string; urls: Set<string | null> }>();
  const groups = new Map<string, RepairGroup>();
  const counts = new Map<string, number>();
  for (const attempt of attempts) {
    if (
      !sameProjectPath(attempt.cwd, cwd) ||
      attempt.repo.toLowerCase() !== repo.toLowerCase() ||
      attempt.number !== number
    )
      continue;
    for (const check of attempt.checks) {
      const key = githubCheckIdentity(check);
      const previous = seen.get(key);
      if (
        previous &&
        (previous.headOid !== attempt.headOid || previous.urls.has(check.url))
      )
        continue;
      if (previous) previous.urls.add(check.url);
      else
        seen.set(key, { headOid: attempt.headOid, urls: new Set([check.url]) });
      const group = groups.get(attempt.sessionId) ?? {
        sessionId: attempt.sessionId,
        items: [],
      };
      group.items.push({
        attempt,
        check,
        state: "waiting",
      });
      counts.set(key, (counts.get(key) ?? 0) + 1);
      groups.set(attempt.sessionId, group);
    }
  }
  for (const group of groups.values()) {
    for (const item of group.items) {
      const key = githubCheckIdentity(item.check);
      item.state = repairState(
        item.attempt,
        item.check,
        view,
        (counts.get(key) ?? 0) > 1,
        state === "merged" || state === "closed"
          ? state
          : (view.checks?.state ?? state),
      );
    }
  }
  return [...groups.values()];
}

const neutral = "text-content/55";
const positive = "text-emerald-700 dark:text-emerald-400";
const negative = "text-rose-700 dark:text-rose-400";
const active = "text-amber-700 dark:text-amber-400";
const states: Record<
  RepairState,
  { label: string; summary: string; Icon: IconComponent; color: string }
> = {
  repairing: {
    label: "Repairing",
    summary: "Repair in progress",
    Icon: LoaderCircle,
    color: active,
  },
  waiting: {
    label: "Awaiting CI",
    summary: "Awaiting new GitHub checks",
    Icon: CircleDashed,
    color: neutral,
  },
  refreshing: {
    label: "Refreshing",
    summary: "Refreshing GitHub checks",
    Icon: LoaderCircle,
    color: neutral,
  },
  stale: {
    label: "Out of date",
    summary: "GitHub results are out of date",
    Icon: CircleDashed,
    color: neutral,
  },
  pass: {
    label: "CI passed",
    summary: "passed",
    Icon: CheckCircle,
    color: positive,
  },
  fail: {
    label: "Still failing",
    summary: "still failing",
    Icon: CircleX,
    color: negative,
  },
  pending: {
    label: "CI running",
    summary: "running",
    Icon: LoaderCircle,
    color: active,
  },
  cancel: {
    label: "CI cancelled",
    summary: "cancelled",
    Icon: CircleDashed,
    color: neutral,
  },
  skipping: {
    label: "CI skipped",
    summary: "skipped",
    Icon: CircleDashed,
    color: neutral,
  },
  unknown: {
    label: "Unknown",
    summary: "unknown",
    Icon: CircleDashed,
    color: neutral,
  },
  stopped: {
    label: "Stopped",
    summary: "Repair stopped",
    Icon: CircleDashed,
    color: neutral,
  },
  "not-needed-merged": {
    label: "Not needed",
    summary: "Not needed: PR merged",
    Icon: CircleDashed,
    color: neutral,
  },
  "not-needed-closed": {
    label: "Not needed",
    summary: "Not needed: PR closed",
    Icon: CircleDashed,
    color: neutral,
  },
  interrupted: {
    label: "Interrupted",
    summary: "Tracking interrupted",
    Icon: CircleDashed,
    color: neutral,
  },
  "agent-error": {
    label: "Agent stopped",
    summary: "Agent could not finish",
    Icon: CircleX,
    color: negative,
  },
};
function StatusIcon({ state }: { state: RepairState }) {
  const { Icon, color } = states[state];
  return (
    <Icon
      aria-hidden="true"
      strokeWidth={1.75}
      className={`size-3.5 shrink-0 ${color} ${["repairing", "refreshing", "pending"].includes(state) ? "animate-spin motion-reduce:animate-none" : ""}`}
    />
  );
}

export function CheckRepairStatus({ item }: { item: RepairItem }) {
  const status = states[item.state];
  return (
    <span
      data-repair-status
      role="status"
      title={status.summary}
      className={`inline-flex shrink-0 items-center gap-1.5 text-[11px] font-medium ${status.color}`}
    >
      <StatusIcon state={item.state} />
      {status.label}
    </span>
  );
}

function RepairCard({
  group,
  repair,
  view,
  onShowCheck,
}: {
  group: RepairGroup;
  repair: CheckRepair;
  view: GithubPrChecksView;
  onShowCheck?: (check: RepairItem["check"]) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const detailsId = useId();
  const counts = new Map<RepairState, number>();
  for (const item of group.items)
    counts.set(item.state, (counts.get(item.state) ?? 0) + 1);
  const priority: RepairState[] = [
    "not-needed-merged",
    "not-needed-closed",
    "repairing",
    "agent-error",
    "fail",
    "stale",
    "refreshing",
    "pending",
    "waiting",
    "interrupted",
    "stopped",
    "cancel",
    "unknown",
    "skipping",
    "pass",
  ];
  const lead = priority.find((state) => counts.has(state))!;
  const label = `${group.items.length} ${group.items.length === 1 ? "check" : "checks"}`;
  const single = group.items.length === 1 ? group.items[0] : undefined;
  const canShowCheck =
    single?.state === "pass" &&
    onShowCheck &&
    view.checks &&
    latestPrChecks(view.checks.checks).filter((check) =>
      repairCheckMatches(single.check, check),
    ).length === 1;
  return (
    <div className="overflow-hidden rounded-lg border border-stroke bg-content/[0.02]">
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5">
        <button
          type="button"
          aria-label={`Repair details for ${label}`}
          aria-expanded={expanded}
          aria-controls={detailsId}
          onClick={() => setExpanded(!expanded)}
          className="flex min-w-0 flex-1 items-center gap-2.5 rounded text-left focus-visible:outline focus-visible:outline-1 focus-visible:outline-content/50"
        >
          <StatusIcon state={lead} />
          <span className="min-w-0 flex-1">
            <span
              role="status"
              className="flex flex-wrap gap-x-3 gap-y-0.5 text-[12px] font-medium"
            >
              {[...counts].map(([state, count]) => (
                <span key={state} className={states[state].color}>
                  {[
                    "pass",
                    "fail",
                    "pending",
                    "cancel",
                    "skipping",
                    "unknown",
                  ].includes(state)
                    ? single
                      ? states[state].label
                      : `${count} ${states[state].summary}`
                    : counts.size === 1
                      ? states[state].summary
                      : `${count} ${states[state].label.toLowerCase()}`}
                </span>
              ))}
            </span>
            <span
              title={
                single
                  ? `${single.check.workflow}: ${single.check.name}`
                  : undefined
              }
              className="mt-0.5 block truncate text-[11px] text-content/65"
            >
              {single ? single.check.name : `CI repair for ${label}`}
            </span>
          </span>
          <ChevronRight
            aria-hidden="true"
            className={`size-3 shrink-0 text-content/40 transition-transform motion-reduce:transition-none ${expanded ? "rotate-90" : ""}`}
          />
        </button>
        {canShowCheck ? (
          <button
            type="button"
            onClick={() => onShowCheck?.(single.check)}
            className="shrink-0 rounded-md px-2 py-1.5 text-[11px] text-content/70 hover:bg-selection hover:text-content focus-visible:outline focus-visible:outline-1 focus-visible:outline-content/50"
          >
            Show check
          </button>
        ) : null}
        {repair.onOpenSession ? (
          <button
            type="button"
            onClick={() => void repair.onOpenSession?.(group.sessionId)}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-stroke px-2.5 py-1.5 text-[11px] text-content/70 hover:bg-selection hover:text-content focus-visible:outline focus-visible:outline-1 focus-visible:outline-content/50"
          >
            <MessageSquare aria-hidden="true" className="size-3.5" />
            Open conversation
          </button>
        ) : null}
      </div>
      {expanded ? (
        <div
          id={detailsId}
          className="space-y-2 border-t border-stroke px-3 py-2.5 text-[11px] text-content/55"
        >
          <p>Included checks</p>
          <ul className="flex max-h-36 flex-wrap gap-1.5 overflow-y-auto">
            {group.items.map(({ check }) => (
              <li
                key={JSON.stringify([check.workflow, check.name, check.url])}
                title={check.workflow}
                className="max-w-full truncate rounded bg-content/5 px-2 py-1 text-content/75"
              >
                {check.name}
              </li>
            ))}
          </ul>
          <p>
            Latest PR commit:{" "}
            <span className="font-mono">
              {view.checks?.headOid.slice(0, 7) || "Unavailable"}
            </span>
            . Results appear in the checks below.
          </p>
        </div>
      ) : null}
    </div>
  );
}

export function CheckRepairProgress({
  cwd,
  repo,
  repair,
  view,
  onShowCheck,
}: {
  cwd: string;
  repo: string;
  repair: CheckRepair;
  view: GithubPrChecksView;
  onShowCheck?: (check: RepairItem["check"]) => void;
}) {
  const groups = useCheckRepairs(cwd, repo, repair.number, view, repair.state);
  const state = (
    repair.state === "merged" || repair.state === "closed"
      ? repair.state
      : (view.checks?.state ?? repair.state)
  )?.toLowerCase();
  const pendingAttempts = groups
    .flatMap((group) => group.items)
    .filter(({ attempt }) => attempt.phase !== "not-needed")
    .map(({ attempt }) => attempt.id)
    .join(",");
  const [stopError, setStopError] = useState<string | null>(null);
  useEffect(() => {
    if ((state !== "merged" && state !== "closed") || !repair.onNotNeeded)
      return;
    let active = true;
    setStopError(null);
    void stopCiRepairs(cwd, repo, repair.number, state, (attempt) =>
      repair.onNotNeeded!(attempt, state),
    ).catch((reason: unknown) => {
      if (active)
        setStopError(reason instanceof Error ? reason.message : String(reason));
    });
    return () => {
      active = false;
    };
  }, [cwd, repo, repair.number, state, repair.onNotNeeded, pendingAttempts]);
  if (!groups.length) return null;
  return (
    <div className="space-y-2" aria-label="Repair progress">
      {stopError ? (
        <p role="alert" className="text-[12px] text-rose-400">
          Could not stop this repair: {stopError}
        </p>
      ) : null}
      {groups.map((group) => (
        <RepairCard
          key={group.sessionId}
          group={group}
          repair={repair}
          view={view}
          onShowCheck={onShowCheck}
        />
      ))}
    </div>
  );
}
