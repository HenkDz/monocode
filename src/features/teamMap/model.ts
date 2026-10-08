import {
  monoLook,
  type Mono,
  type MonoState,
  type MonoStatus,
} from "../monos/model/mono";
import { memberTasks, monoLiveState } from "../monos/model/monoNavigation";
import {
  activityTaskTitle,
  orgDescendants,
} from "../monos/model/monoTeamActivity";
import type { CrewMessage } from "../monos/model/monoCrewEvents";
import type { MonoManagerGoal } from "../monos/model/monoManagerGoals";
import { crewFeed } from "../monos/ui/MonoOrgActivity";
import {
  managerPrReady,
  managerTaskFinished,
  managerTaskLifecycle,
  taskPrStatus,
} from "../orchestration/model/projectManager";
import type { OrchestrationRun } from "../orchestration/model/orchestrationState";
import { RUNTIME_MODE_LABEL, type Session } from "../sessions/model/session";
import type { GitPr } from "../../platform/tauri/fs";
import { projectKey } from "../../shared/lib/paths";

export const TEAM_MAP_NODE_WIDTH = 240;
export const TEAM_MAP_NODE_HEIGHT = 130;
const gap = 32;
const row = 216;

export type TeamMapNode = {
  id: string;
  mono: Mono;
  state: MonoState;
  status: MonoStatus | "pr-ready";
  title: string;
  model: string;
  permissions: string;
  lastReport: string;
  x: number;
  y: number;
  parentId?: string;
  project?: string;
  summary?: string;
  hiddenCount: number;
};
export type TeamMapEdge = {
  id: string;
  source: string;
  target: string;
  label?: string;
  flow?: "down" | "up";
  tooltip: string;
};
export type TeamMapInput = {
  roster: readonly Mono[];
  runs: readonly OrchestrationRun[];
  sessions: readonly Session[];
  statuses?: ReadonlyMap<string, GitPr | null>;
  project?: string;
  scope?: string;
  collapsed?: ReadonlySet<string>;
};

export function buildTeamMap({
  roster,
  runs,
  sessions,
  statuses = new Map(),
  project,
  scope,
  collapsed = new Set(),
}: TeamMapInput) {
  const active = [
    ...new Map(
      roster
        .filter((mono) => mono.archivedAt == null)
        .map((mono) => [mono.id, mono]),
    ).values(),
  ];
  const byId = new Map(active.map((mono) => [mono.id, mono]));
  const orchestrator = active.find((mono) => mono.role === "orchestrator");
  const parents = new Map<string, string>();
  for (const mono of active) {
    const parent =
      mono.reportsTo && byId.has(mono.reportsTo)
        ? mono.reportsTo
        : mono.role === "manager"
          ? orchestrator?.id
          : undefined;
    if (mono.role && parent && parent !== mono.id) parents.set(mono.id, parent);
  }
  // Broken legacy relationships remain visible as roots, without recursive cycles.
  for (const mono of active) {
    const seen = new Set([mono.id]);
    let parent = parents.get(mono.id);
    while (parent) {
      if (seen.has(parent)) {
        parents.delete(mono.id);
        break;
      }
      seen.add(parent);
      parent = parents.get(parent);
    }
  }
  const projectFor = (mono: Mono) => {
    let current: Mono | undefined = mono;
    while (current) {
      if (current.role === "manager")
        return current.managerProject ?? current.projects[0];
      current = byId.get(parents.get(current.id) ?? "");
    }
    return mono.role === "orchestrator"
      ? undefined
      : (mono.managerProject ?? mono.projects[0]);
  };
  const scoped = scope
    ? orgDescendants(active, scope)
    : new Set(active.map((mono) => mono.id));
  const included = new Set(
    active
      .filter(
        (mono) =>
          scoped.has(mono.id) &&
          (!project ||
            projectKey(projectFor(mono) ?? "") === projectKey(project)),
      )
      .map((mono) => mono.id),
  );
  if (project)
    for (const id of [...included]) {
      let parent = parents.get(id);
      while (parent && scoped.has(parent)) {
        included.add(parent);
        parent = parents.get(parent);
      }
    }
  const children = (id: string) =>
    active.filter(
      (mono) => included.has(mono.id) && parents.get(mono.id) === id,
    );
  const descendants = (id: string): Mono[] =>
    children(id).flatMap((mono) => [mono, ...descendants(mono.id)]);
  const hidden = new Set(
    [...collapsed].flatMap((id) => descendants(id).map((mono) => mono.id)),
  );
  const visible = active.filter(
    (mono) => included.has(mono.id) && !hidden.has(mono.id),
  );
  const liveStates = new Map(
    active.map((mono) => [
      mono.id,
      monoLiveState(active, runs, sessions, mono.id),
    ]),
  );
  const taskUpdated = new Map<string, number>();
  for (const run of runs)
    for (const dispatch of run.dispatches ?? [])
      taskUpdated.set(
        dispatch.taskId,
        Math.max(taskUpdated.get(dispatch.taskId) ?? 0, dispatch.updatedAt),
      );
  const nodes: TeamMapNode[] = visible.map((mono) => {
    const state = liveStates.get(mono.id)!;
    const scope = orgDescendants(active, mono.id);
    const tasks =
      mono.role === "member"
        ? memberTasks(runs, mono.id)
        : runs
            .filter((run) => scope.has(run.ownerMonoId ?? ""))
            .flatMap((run) => run.tasks);
    tasks.sort(
      (a, b) => (taskUpdated.get(b.id) ?? 0) - (taskUpdated.get(a.id) ?? 0),
    );
    const current =
      tasks.find((task) => ["running", "cancelling"].includes(task.status)) ??
      tasks.find((task) => task.status === "queued");
    const ownSession = sessions.find(
      (session) => session.id === mono.sessionId,
    );
    const worker = sessions.find(
      (session) => session.id === current?.sessionId,
    );
    const ready = tasks.find((task) =>
      managerPrReady(task, taskPrStatus(task, statuses)),
    );
    const teammates = descendants(mono.id);
    return {
      id: mono.id,
      mono,
      state,
      status: state.status === "idle" && ready ? "pr-ready" : state.status,
      title: current
        ? activityTaskTitle(current)
        : ready
          ? activityTaskTitle(ready)
          : state.status === "working"
            ? mono.role === "orchestrator"
              ? "Coordinating projects"
              : mono.role === "manager"
                ? "Coordinating the team"
                : "Working in chat"
            : (state.activity ?? "Ready for the next task"),
      model:
        current?.model ??
        mono.workerProfile?.model ??
        ownSession?.model ??
        "Default model",
      permissions: current?.readOnly
        ? "Read only"
        : ownSession || worker
          ? RUNTIME_MODE_LABEL[(worker ?? ownSession)!.runtimeMode]
          : "Configured in chat",
      lastReport:
        tasks.find((task) => task.result.trim())?.result ?? "No report yet",
      x: 0,
      y: 0,
      parentId: included.has(parents.get(mono.id) ?? "")
        ? parents.get(mono.id)
        : undefined,
      project: projectFor(mono),
      hiddenCount: collapsed.has(mono.id) ? teammates.length : 0,
      summary:
        mono.role === "manager" && collapsed.has(mono.id) && teammates.length
          ? `${teammates.length} teammates · ${teammates.filter((member) => monoLiveState(active, runs, sessions, member.id).status === "working").length} working`
          : undefined,
    };
  });
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const sorted = (values: TeamMapNode[]) =>
    values.sort(
      (a, b) =>
        Number(!a.mono.role) - Number(!b.mono.role) ||
        monoLook(a.mono).name.localeCompare(monoLook(b.mono).name) ||
        a.id.localeCompare(b.id),
    );
  const nodeChildren = (id: string) =>
    sorted(nodes.filter((node) => node.parentId === id));
  const widths = new Map<string, number>();
  const measure = (node: TeamMapNode): number => {
    const children = nodeChildren(node.id);
    const width = Math.max(
      TEAM_MAP_NODE_WIDTH,
      children.reduce((sum, child) => sum + measure(child), 0) +
        Math.max(0, children.length - 1) * gap,
    );
    widths.set(node.id, width);
    return width;
  };
  const place = (node: TeamMapNode, left: number, depth: number) => {
    node.x = left + (widths.get(node.id)! - TEAM_MAP_NODE_WIDTH) / 2;
    node.y = 48 + depth * row;
    for (const child of nodeChildren(node.id)) {
      place(child, left, depth + 1);
      left += widths.get(child.id)! + gap;
    }
  };
  let left = 48;
  const rootRank = (node: TeamMapNode) =>
    node.mono.role === "orchestrator" ? 0 : node.mono.role ? 1 : 2;
  const roots = sorted(
    nodes.filter((node) => !node.parentId || !nodeById.has(node.parentId)),
  ).sort((a, b) => rootRank(a) - rootRank(b));
  for (const root of roots) {
    measure(root);
    place(root, left, 0);
    left += widths.get(root.id)! + gap * 2;
  }
  const edges: TeamMapEdge[] = nodes.flatMap((node) => {
    if (!node.parentId || !nodeById.has(node.parentId)) return [];
    const tasks =
      node.mono.role === "manager"
        ? runs
            .filter((run) => run.ownerMonoId === node.id)
            .flatMap((run) => run.tasks)
        : memberTasks(runs, node.id);
    const pending = tasks.filter(
      (task) =>
        ["queued", "running", "cancelling", "completed"].includes(
          task.status,
        ) && !managerTaskFinished(task, taskPrStatus(task, statuses)),
    );
    const working = pending.find(
      (task) =>
        ["running", "cancelling"].includes(task.status) &&
        task.memberId &&
        liveStates.get(task.memberId)?.status === "working",
    );
    const queued = pending.find(
      (task) =>
        task.status === "queued" &&
        task.memberId &&
        liveStates.has(task.memberId) &&
        liveStates.get(task.memberId)?.status !== "needs-you",
    );
    const flow =
      working || node.status === "working"
        ? ("up" as const)
        : queued
          ? ("down" as const)
          : undefined;
    const task = working ?? queued ?? pending[0];
    const lifecycle =
      task && managerTaskLifecycle(task, taskPrStatus(task, statuses));
    const label = task
      ? lifecycle?.[0] === "In review"
        ? "In review"
        : task.prUrl
          ? `PR #${task.prUrl.match(/\/(\d+)\/?$/)?.[1] ?? "ready"}`
          : activityTaskTitle(task)
      : undefined;
    const workerName = monoLook(byId.get(task?.memberId ?? "") ?? node.mono).name;
    const parentName = monoLook(nodeById.get(node.parentId)!.mono).name;
    const tooltip = flow === "up"
      ? `${workerName} is working on ${task ? activityTaskTitle(task) : node.title} · progress reports up to ${parentName}`
      : flow === "down"
        ? `${parentName} assigned ${task ? activityTaskTitle(task) : node.title} · waiting for ${workerName} to start`
        : `${monoLook(node.mono).name} reports to ${parentName}${label ? ` · ${label}` : ""}`;
    return [
      {
        id: `${node.parentId}->${node.id}`,
        source: node.parentId,
        target: node.id,
        label,
        flow,
        tooltip,
      },
    ];
  });
  return {
    nodes: roots.flatMap(function visit(node): TeamMapNode[] {
      return [node, ...nodeChildren(node.id).flatMap(visit)];
    }),
    edges,
    width: Math.max(320, left + 16),
    height: Math.max(
      240,
      ...nodes.map((node) => node.y + TEAM_MAP_NODE_HEIGHT + 48),
    ),
  };
}

export type TeamMapEvent = {
  id: string;
  at: number;
  source: string;
  target: string;
  label: string;
  kind: "dispatch" | "report" | "review" | "pr" | "escalation" | "message" | "closed" | "accepted";
  taskId?: string;
  changes?: boolean;
};

export function teamMapEvents({
  roster,
  runs,
  sessions,
  statuses = new Map(),
  scope,
  project,
  messages = [],
  goals = [],
}: TeamMapInput & {
  messages?: readonly CrewMessage[];
  goals?: readonly MonoManagerGoal[];
}): TeamMapEvent[] {
  const events = new Map<string, Omit<TeamMapEvent, "id" | "at" | "label">>();
  const tasks = new Map(
    runs.flatMap((run) => run.tasks.map((task) => [task.id, task] as const)),
  );
  for (const run of runs)
    for (const task of run.tasks) {
      const member = task.memberId;
      const manager =
        run.ownerMonoId ?? roster.find((mono) => mono.id === member)?.reportsTo;
      if (!member || !manager) continue;
      for (const dispatch of (run.dispatches ?? []).filter(
        (dispatch) => dispatch.taskId === task.id,
      )) {
        events.set(`${dispatch.id}:start`, {
          source: manager,
          target: member,
          kind: "dispatch",
          taskId: task.id,
        });
        events.set(`${dispatch.id}:end`, {
          source: member,
          target: manager,
          kind: ["blocked", "failed", "interrupted"].includes(dispatch.state)
            ? "escalation"
            : "report",
          taskId: task.id,
        });
      }
      events.set(`${task.id}:handoff`, {
        source: manager,
        target: member,
        kind: "dispatch",
        taskId: task.id,
      });
      events.set(`${task.id}:pr`, {
        source: member,
        target: manager,
        kind: "pr",
        taskId: task.id,
      });
      events.set(`${task.id}:finished`, {
        source: member,
        target: manager,
        kind: task.completionOutcome?.startsWith("no-changes") ? "accepted" : "closed",
        taskId: task.id,
      });
      if (task.reviewVerdict)
        events.set(`${task.id}:review:${task.reviewVerdict.dispatchId}`, {
          source: member,
          target: task.reviewOf
            ? (tasks.get(task.reviewOf.taskId)?.memberId ?? manager)
            : manager,
          kind: "review",
          taskId: task.reviewOf?.taskId ?? task.id,
          changes: task.reviewVerdict.decision === "changes",
        });
    }
  const feed: TeamMapEvent[] = crewFeed(
    roster,
    runs,
    statuses,
    sessions,
  ).flatMap((event) => {
    const route = events.get(event.id);
    const reviewed =
      route?.kind === "review"
        ? [...tasks.values()].find(
            (task) =>
              `${task.id}:review:${task.reviewVerdict?.dispatchId}` ===
              event.id,
          )
        : undefined;
    const verdict = reviewed?.reviewVerdict;
    const reviewedAt =
      verdict &&
      runs
        .flatMap((run) => run.dispatches ?? [])
        .find((dispatch) => dispatch.id === verdict.dispatchId)?.updatedAt;
    const id = verdict
      ? `${event.id}:${verdict.decision}:${verdict.headOid ?? ""}:${verdict.artifactId ?? ""}`
      : event.id;
    const task = route?.taskId && tasks.get(route.taskId);
    return route
      ? [{ ...route, id, at: reviewedAt ?? event.at, label: task ? activityTaskTitle(task) : event.text }]
      : [];
  });
  for (const message of messages) {
    const text = `${message.topic} ${message.summary ?? ""} ${message.text}`;
    const taskIds = text.split(/\s+/);
    const namedTasks = [...tasks.values()].filter(task => taskIds.includes(task.id));
    const matchingTasks = namedTasks.length ? namedTasks : [...tasks.values()].filter(task =>
      task.title.length > 3 && text.toLowerCase().includes(task.title.toLowerCase()),
    );
    const relatedTask = matchingTasks.length === 1 ? matchingTasks[0] : undefined;
    const kind = /\b(escalation|blocked|needs you)\b/i.test(message.topic)
      ? "escalation"
      : /\b(accepted|acceptance)\b[^\n]*\bno[- ]changes\b/i.test(text)
        ? "accepted"
        : /\b(closed|closure)\b/i.test(message.topic)
          ? "closed"
          : /\b(report|completion|completed)\b/i.test(message.topic)
            ? "report"
            : /\b(dispatch|assignment|delegation)\b/i.test(message.topic)
              ? "dispatch"
              : /\breview\b/i.test(message.topic)
                ? "review"
                : /\bpr ready\b/i.test(message.topic)
                  ? "pr"
                  : "message";
    feed.push({
      id: message.id,
      at: message.at,
      source:
        message.senderId === "user" ? message.managerId : message.senderId,
      target: message.recipientId,
      label: relatedTask ? activityTaskTitle(relatedTask) : message.summary ?? `${message.topic}: ${message.text}`,
      taskId: relatedTask?.id,
      kind,
      ...(kind === "review"
        ? { changes: /\bchanges?\b/i.test(message.topic) || /\b(changes? requested|requested changes?)\b/i.test(text) }
        : {}),
    });
  }
  for (const goal of goals.filter((goal) => !goal.archived)) {
    const managerId =
      runs.find((run) => run.leadId === goal.managerId)?.ownerMonoId ??
      roster.find(
        (mono) =>
          mono.role === "manager" &&
          [mono.id, mono.managerEngineId, mono.sessionId].includes(
            goal.managerId,
          ),
      )?.id;
    if (!managerId) continue;
    feed.push({
      id: `goal:${goal.id}:start`,
      at: goal.createdAt,
      source: goal.monoId,
      target: managerId,
      label: goal.title,
      kind: "dispatch",
    });
    if (["ready", "done", "needs-you", "blocked"].includes(goal.state))
      feed.push({
        id: `goal:${goal.id}:${goal.state}:${goal.updatedAt}`,
        at: goal.updatedAt,
        source: managerId,
        target: goal.monoId,
        label: `${goal.title} · ${goal.state}`,
        kind:
          goal.state === "ready"
            ? "pr"
            : goal.state === "done"
              ? "report"
              : "escalation",
      });
  }
  const active = new Set(
    roster.filter((mono) => mono.archivedAt == null).map((mono) => mono.id),
  );
  const included = new Set(
    buildTeamMap({
      roster,
      runs,
      sessions,
      statuses,
      scope,
      project,
    }).nodes.map((node) => node.id),
  );
  const context = new Set<string>();
  let ancestor = roster.find((mono) => mono.id === scope)?.reportsTo;
  while (ancestor && !context.has(ancestor)) {
    context.add(ancestor);
    ancestor = roster.find((mono) => mono.id === ancestor)?.reportsTo;
  }
  return [
    ...new Map(
      feed
        .filter(
          (event) =>
            active.has(event.source) &&
            active.has(event.target) &&
            ((included.has(event.source) && included.has(event.target)) ||
              (event.target === scope &&
                included.has(event.target) &&
                context.has(event.source)) ||
              (event.source === scope &&
                included.has(event.source) &&
                context.has(event.target))),
        )
        .map((event) => [event.id, event]),
    ).values(),
  ].sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
}

export function teamMapFeed(events: readonly TeamMapEvent[], roster: readonly Mono[]) {
  const feed: (TeamMapEvent & { count: number; sentence: string })[] = [];
  const name = (id: string) => {
    const mono = roster.find(mono => mono.id === id);
    return mono ? monoLook(mono).name : id;
  };
  const verbs: Record<TeamMapEvent["kind"], string> = {
    dispatch: "assigned", report: "reported", review: "approved", pr: "PR ready",
    escalation: "escalated", message: "Message", closed: "closed", accepted: "accepted (no changes)",
  };
  const key = (event: TeamMapEvent) => JSON.stringify([
    event.kind, event.source, event.target, event.taskId ?? event.label.trim().replace(/\s+/g, " ").toLowerCase(), event.changes,
  ]);
  for (const event of [...events].sort((a, b) => b.at - a.at || b.id.localeCompare(a.id))) {
    const previous = feed[feed.length - 1];
    if (previous && key(previous) === key(event)) {
      previous.count++;
      continue;
    }
    const verb = event.kind === "review" && event.changes ? "requested changes" : verbs[event.kind];
    const title = event.label.replace(/\s+/g, " ").trim();
    feed.push({ ...event, count: 1, sentence: `${name(event.source)} → ${name(event.target)} · ${verb} · ${title.length > 100 ? `${title.slice(0, 97)}…` : title}` });
  }
  return feed;
}

export function teamMapEventAnimation(
  event: TeamMapEvent,
  reducedMotion: boolean,
) {
  return {
    animated: !reducedMotion,
    dashed: event.kind === "review" && !!event.changes,
    direction:
      event.kind === "dispatch"
        ? ("down" as const)
        : ["report", "pr", "escalation", "closed", "accepted"].includes(event.kind)
          ? ("up" as const)
          : ("across" as const),
  };
}

export function teamMapEventEdges(
  event: TeamMapEvent,
  edges: readonly TeamMapEdge[],
): string[] {
  const queue: { id: string; path: string[] }[] = [
    { id: event.source, path: [] },
  ];
  const seen = new Set([event.source]);
  for (const step of queue) {
    if (step.id === event.target) return step.path;
    for (const edge of edges) {
      const next =
        edge.source === step.id
          ? edge.target
          : edge.target === step.id
            ? edge.source
            : undefined;
      if (next && !seen.has(next)) {
        seen.add(next);
        queue.push({ id: next, path: [...step.path, edge.id] });
      }
    }
  }
  return [];
}

export function teamMapKeyboardNode(
  nodes: readonly Pick<TeamMapNode, "id" | "x" | "y">[],
  currentId: string,
  key: string,
): string {
  const current = nodes.find((node) => node.id === currentId);
  if (!current) return nodes[0]?.id ?? currentId;
  const directions: Record<string, readonly number[]> = {
    ArrowLeft: [-1, 0],
    ArrowRight: [1, 0],
    ArrowUp: [0, -1],
    ArrowDown: [0, 1],
  };
  const direction = directions[key];
  if (!direction) return currentId;
  const score = (node: Pick<TeamMapNode, "x" | "y">) => {
    const dx = node.x - current.x,
      dy = node.y - current.y;
    return (
      Math.hypot(dx, dy) + Math.abs(dx * direction[1] - dy * direction[0]) * 2
    );
  };
  return (
    nodes
      .filter(
        (node) =>
          (node.x - current.x) * direction[0] +
            (node.y - current.y) * direction[1] >
          0,
      )
      .sort((a, b) => score(a) - score(b) || a.id.localeCompare(b.id))[0]?.id ??
    currentId
  );
}

export function teamMapMatches(
  node: TeamMapNode,
  needsYou: boolean,
  project?: string,
) {
  return (
    (!needsYou || node.status === "needs-you") &&
    (!project ||
      (!!node.project && projectKey(node.project) === projectKey(project)))
  );
}
