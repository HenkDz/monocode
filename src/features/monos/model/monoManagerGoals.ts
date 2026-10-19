import { invoke } from "@tauri-apps/api/core";
import { pathKey } from "../../../shared/lib/paths";
import type { OrchestrationRun } from "../../orchestration/model/orchestration";
import { managerTaskFinished } from "../../orchestration/model/projectManager";
import { prStatusKey } from "../../source-control/hooks/usePrStatus";
import type { GitPr } from "../../../platform/tauri/fs";
import type { Mono, MonoProject } from "./mono";
import type { Block } from "../../sessions/model/session";
import { assertManagerRequest } from "./managerAuthorizedWork";
import type { ManagerRequestRecovery } from "./managerAuthorizedWork";
import { handleDecisionCommand, recoverDecisionReceipt, validateDecisionHistory, quarantineDecisionHistory, compactDecisionHistory, projectAutonomy } from "./monoDecisions";
import type { DecisionCommand, DecisionHost, DecisionReceipt, DecisionQuarantine, MonoDecision, ProjectAutonomy } from "./monoDecisions";

/** Non-repository recents must not hide the projects that can own a Manager. */
export async function validManagerProjects(projects: readonly MonoProject[], resolve: (path: string) => Promise<string>): Promise<{ project: MonoProject; folder: string }[]> {
  const roots = await Promise.allSettled(projects.map(async project => ({ project, folder: await resolve(project.path) })));
  return roots.flatMap(result => result.status === "fulfilled" ? [result.value] : []);
}

export const MANAGER_ACTIONS = [
  "projects.list",
  "projects.status",
  "goals.assign",
  "goals.message",
  "goals.cancel",
  "prs.ready",
] as const;
export type GoalStatus =
  | "queued"
  | "running"
  | "needs-you"
  | "ready"
  | "done"
  | "cancelled"
  | "blocked";
export type GoalRouteMetadata = {
  sourceUserMessageId: string;
  projectId: string;
  managerId: string;
  managerMonoId?: string;
  reason: string;
  override: "auto" | "manager";
};
export type MonoManagerGoal = {
  id: string;
  monoId: string;
  projectId: string;
  managerId: string;
  userMessageId: string;
  requestId: string;
  title: string;
  state: GoalStatus;
  prUrls: string[];
  createdAt: number;
  updatedAt: number;
  archived?: boolean;
  route?: GoalRouteMetadata;
};
type Receipt = {
  signature: string;
  result: unknown;
  pending?: { goalId: string; text: string; cancel?: boolean; request?: ManagerRequestRecovery };
  decision?: DecisionReceipt;
};
export type GoalLedger = {
  version: 1;
  goals: MonoManagerGoal[];
  receipts: Record<string, Receipt>;
  events?: Record<string, MonoManagerGoal>;
  decisions?: MonoDecision[];
  autonomy?: Record<string, ProjectAutonomy>;
  decisionsPruned?: number;
  decisionQuarantine?: DecisionQuarantine[];
};
export type GoalOrigin = {
  kind: "user" | "habit" | "event";
  messageId: string;
};
export type ManagerProject = {
  id: string;
  name: string;
  folder: string;
  branch?: string;
  managerId: string;
  managerExists: boolean;
  managerMonoId?: string;
  running: number;
  needsDecision: number;
  ready: number;
  blocked: string[];
  goals: string[];
};
export type ManagerReadyPr = {
  goalId?: string;
  projectId: string;
  project: string;
  managerId: string;
  taskId: string;
  title: string;
  branch: string;
  url: string;
  cwd: string;
  checks: string;
};
export type ManagerGoalHost = {
  requestAuthority?: ManagerRequestRecovery;
  mayDelegate(monoId: string): boolean;
  projects(monoId: string): Promise<ManagerProject[]>;
  status(monoId: string, projectId: string, before?: string): Promise<unknown>;
  ready(monoId: string): Promise<ManagerReadyPr[]>;
  deliver(
    goal: MonoManagerGoal,
    text: string,
    receiptId: string,
    cancel: boolean,
    validate?: () => void,
    request?: ManagerRequestRecovery,
  ): Promise<void>;
};
type Store = {
  load(id: string): Promise<GoalLedger | null>;
  save(id: string, ledger: GoalLedger): Promise<void>;
};
const store: Store = {
  load: async (id) => {
    const raw = await invoke<string | null>("control_load", {
      leadId: `mono-goals:${id}`,
    });
    return raw ? JSON.parse(raw) : null;
  },
  save: (id, ledger) =>
    invoke("control_save", {
      leadId: `mono-goals:${id}`,
      state: JSON.stringify(ledger),
    }),
};
const terminal = (state: GoalStatus) =>
  state === "done" || state === "cancelled";
const text = (value: unknown, label: string, max = 8000) => {
  if (typeof value !== "string" || !value.trim() || value.length > max)
    throw Error(`Invalid ${label}`);
  return value.trim();
};
const fields: Record<string, string[]> = {
  "projects.list": [],
  "projects.status": ["projectId", "before"],
  "goals.assign": ["projectId", "goal"],
  "goals.message": ["goalId", "text"],
  "goals.cancel": ["goalId"],
  "prs.ready": [],
};

/** Durable receipts precede manager delivery. A retry replays only the undelivered outbox entry. */
export class MonoManagerGoals {
  private ledgers = new Map<string, GoalLedger>();
  // ponytail: serialize the small app-wide ledger; split by Mono if dispatch throughput warrants it.
  private tail: Promise<unknown> = Promise.resolve();
  private listeners = new Set<() => void>();
  private revision = 0;
  constructor(private storage: Store = store) {}
  snapshot = () => this.revision;
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  goals(id?: string) {
    return id
      ? (this.ledgers.get(id)?.goals ?? [])
      : [...this.ledgers.values()].flatMap((ledger) => ledger.goals);
  }
  isCancelling(goalId: string): boolean {
    return [...this.ledgers.values()].some(ledger => Object.values(ledger.receipts).some(receipt => receipt.pending?.cancel && receipt.pending.goalId === goalId));
  }
  deliveryPending(monoId: string, requestId: string): boolean {
    return !!this.ledgers.get(monoId)?.receipts[requestId]?.pending;
  }
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.tail.then(fn);
    this.tail = next.catch(() => undefined);
    return next;
  }
  private async load(id: string) {
    if (this.ledgers.has(id)) return this.ledgers.get(id)!;
    let ledger = (await this.storage.load(id)) ?? {
      version: 1 as const,
      goals: [],
      receipts: {},
    };
    if (
      ledger.version !== 1 ||
      !Array.isArray(ledger.goals) ||
      !ledger.receipts ||
      typeof ledger.receipts !== "object" ||
      Array.isArray(ledger.receipts) ||
      ledger.goals.some(
        (goal) =>
          goal.monoId !== id ||
          typeof goal.id !== "string" ||
          typeof goal.managerId !== "string",
      )
    )
      throw Error("Unsupported Mono goal history");
    const recovered = quarantineDecisionHistory(ledger, id);
    if (recovered !== ledger) {
      await this.save(id, recovered);
      return recovered;
    }
    this.ledgers.set(id, ledger);
    this.changed();
    return ledger;
  }
  hydrate(id: string) {
    return this.serial(() => this.load(id));
  }
  decisions(id: string): MonoDecision[] {
    return structuredClone(this.ledgers.get(id)?.decisions ?? []);
  }
  decisionHistoryState(id: string): "loading" | "ready" {
    return this.ledgers.has(id) ? "ready" : "loading";
  }
  decisionQuarantine(id: string): DecisionQuarantine[] {
    return structuredClone(this.ledgers.get(id)?.decisionQuarantine ?? []);
  }
  decisionsPruned(id: string): number {
    return this.ledgers.get(id)?.decisionsPruned ?? 0;
  }
  autonomy(id: string, projectId: string): ProjectAutonomy {
    return projectAutonomy(this.ledgers.get(id)?.autonomy?.[projectId]);
  }
  handleDecision(id: string, requestId: string, command: DecisionCommand, host: DecisionHost) {
    const retained = structuredClone(command);
    const authenticatedHost: DecisionHost = { actor: structuredClone(host.actor),
      roster: () => host.roster(), current: decision => host.current(decision), deliver: (delivery, validate) => host.deliver(delivery, validate) };
    return this.serial(async () => {
      await this.load(id);
      return handleDecisionCommand(id, requestId, retained, authenticatedHost, {
        read: () => this.ledgers.get(id)!, save: (owner, ledger) => this.save(owner, ledger),
      });
    });
  }
  recoverDecisions(id: string, host: DecisionHost) {
    return this.serial(async () => {
      const ledger = await this.load(id);
      for (const [requestId, receipt] of Object.entries(ledger.receipts)) {
        if (receipt.decision?.remaining.length) await recoverDecisionReceipt(id, requestId, host, {
          read: () => this.ledgers.get(id)!, save: (owner, value) => this.save(owner, value),
        });
      }
    });
  }
  anchorManagerRequest(manager: Mono, project: ManagerProject, block: Block) {
    return this.serial(async () => {
      assertManagerRequest(manager, project, block);
      const ledger = await this.load(manager.id);
      const existing = ledger.goals.find(goal => goal.userMessageId === block.id);
      if (existing) {
        if (existing.managerId !== project.managerId || existing.projectId !== project.id ||
            existing.state === "cancelled" || this.isCancelling(existing.id))
          throw Error("The original request is cancelled or its Manager changed");
        return existing;
      }
      if (ledger.goals.filter(goal => !terminal(goal.state)).length >= 100)
        throw Error("Finish active goals before adding more");
      const goal: MonoManagerGoal = {
        id: crypto.randomUUID(), monoId: manager.id, managerId: project.managerId,
        projectId: project.id, userMessageId: block.id, requestId: `manager-${block.id}`,
        title: block.text.trim().slice(0, 8000), state: "queued", prUrls: [],
        createdAt: Date.now(), updatedAt: Date.now(),
      };
      await this.save(manager.id, { ...ledger, goals: [...ledger.goals, goal] });
      return goal;
    });
  }
  retireManagerRequests(managerId: string) {
    return this.serial(async () => {
      for (const [id, ledger] of this.ledgers) {
        const goals = ledger.goals.map(goal => goal.managerId === managerId && !terminal(goal.state)
          ? { ...goal, state: "cancelled" as const, updatedAt: Date.now() } : goal);
        if (goals.some((goal, index) => goal !== ledger.goals[index])) await this.save(id, { ...ledger, goals });
      }
    });
  }
  events(id: string) {
    return Object.values(this.ledgers.get(id)?.events ?? {});
  }
  acknowledgeEvents(id: string, events: MonoManagerGoal[]) {
    return this.serial(async () => {
      const ledger = await this.load(id);
      const pending = { ...ledger.events };
      for (const event of events)
        if (pending[event.id]?.updatedAt === event.updatedAt)
          delete pending[event.id];
      await this.save(id, { ...ledger, events: pending });
    });
  }
  private changed() {
    this.revision++;
    this.listeners.forEach((fn) => fn());
  }
  private async save(id: string, ledger: GoalLedger) {
    const previous = this.ledgers.get(id)?.decisionQuarantine ?? [];
    if (previous.some((entry, index) => JSON.stringify(entry) !== JSON.stringify(ledger.decisionQuarantine?.[index])))
      throw Error("Quarantined decision evidence is read-only");
    validateDecisionHistory(ledger, id);
    ledger = compactDecisionHistory(ledger);
    if (new TextEncoder().encode(JSON.stringify(ledger)).length > 7_000_000)
      throw Error("Goal history capacity reached; existing work is retained");
    await this.storage.save(id, ledger);
    this.ledgers.set(id, ledger);
    this.changed();
  }
  private async deliver(id: string, requestId: string, host: ManagerGoalHost) {
    const ledger = this.ledgers.get(id)!;
    const receipt = ledger.receipts[requestId];
    if (!receipt.pending) return;
    const goal = ledger.goals.find(
      (goal) => goal.id === receipt.pending!.goalId,
    );
    if (!goal) throw Error("Goal receipt references missing state");
    const routedAssignment = !!goal.route && goal.requestId === requestId;
    if (routedAssignment && goal.state === "cancelled") {
      await this.save(id, { ...ledger, receipts: { ...ledger.receipts,
        [requestId]: { signature: receipt.signature, result: receipt.result } } });
      return;
    }
    if (routedAssignment && this.isCancelling(goal.id)) return;
    try {
      if (routedAssignment) {
        const project = (await host.projects(id)).find(project => project.id === goal.projectId);
        if (!project?.managerExists || project.managerId !== goal.managerId ||
            goal.route!.managerMonoId !== undefined && goal.route!.managerMonoId !== project.managerMonoId)
          throw Error("Routed Manager is no longer available");
      }
      await host.deliver(
        goal,
        receipt.pending.text,
        `mono-goal-${id}-${requestId}`,
        !!receipt.pending.cancel,
        undefined,
        receipt.pending.request,
      );
      await this.save(id, {
        ...ledger,
        goals: receipt.pending.cancel || routedAssignment && goal.state === "blocked"
          ? ledger.goals.map((entry) =>
              entry.id === goal.id
                ? { ...entry, state: receipt.pending!.cancel ? "cancelled" as const : "queued" as const, updatedAt: Date.now() }
                : entry,
            )
          : ledger.goals,
        receipts: {
          ...ledger.receipts,
          [requestId]: { signature: receipt.signature, result: receipt.result },
        },
      });
    } catch (error) {
      if (routedAssignment && goal.state !== "blocked")
        await this.save(id, { ...ledger, goals: ledger.goals.map(entry => entry.id === goal.id
          ? { ...entry, state: "blocked" as const, updatedAt: Date.now() } : entry) });
      throw error;
    }
  }
  recover(id: string, host: ManagerGoalHost) {
    return this.serial(async () => {
      const ledger = await this.load(id);
      for (const [requestId, receipt] of Object.entries(ledger.receipts))
        if (receipt.pending) await this.deliver(id, requestId, host);
    });
  }
  handle(
    monoId: string,
    origin: GoalOrigin | undefined,
    requestId: string,
    action: string,
    input: Record<string, unknown>,
    host: ManagerGoalHost,
    route?: GoalRouteMetadata,
  ) {
    return this.serial(async () => {
      if (!origin) throw Error("No active Mono or user-approved habit turn");
      if (
        !Object.prototype.hasOwnProperty.call(fields, action) ||
        Object.keys(input).some((key) => !fields[action].includes(key))
      )
        throw Error("Unknown Manager action or input field");
      if (!/^[A-Za-z0-9_-]{1,128}$/.test(requestId))
        throw Error("Invalid requestId");
      if (route !== undefined) {
        if (!route || action !== "goals.assign" || origin.kind !== "user" ||
            typeof route.sourceUserMessageId !== "string" || !route.sourceUserMessageId || route.sourceUserMessageId !== origin.messageId ||
            !["auto", "manager"].includes(route.override))
          throw Error("Invalid user goal route");
        text(route.reason, "route reason");
        if (route.managerMonoId !== undefined) text(route.managerMonoId, "route Manager");
      }
      const ledger = await this.load(monoId);
      const signature = JSON.stringify([
        action,
        Object.entries(input).sort(([a], [b]) => a.localeCompare(b)),
        ...(route ? [[route.sourceUserMessageId, route.projectId, route.managerId, route.reason, route.override,
          ...(route.managerMonoId !== undefined ? [route.managerMonoId] : [])]] : []),
      ]);
      const previous = Object.prototype.hasOwnProperty.call(
        ledger.receipts,
        requestId,
      )
        ? ledger.receipts[requestId]
        : undefined;
      if (previous) {
        if (previous.signature !== signature)
          throw Error("Request ID already used with different input");
        const owned = ledger.goals.find(
          (goal) =>
            goal.requestId === requestId ||
            goal.id === previous.pending?.goalId,
        );
        if (owned) {
          const project = (await host.projects(monoId)).find(project => project.id === owned.projectId);
          if (!project) throw Error("Project is no longer assigned to this Mono");
          if (route && (!project.managerExists || project.managerId !== route.managerId ||
              route.managerMonoId !== undefined && route.managerMonoId !== project.managerMonoId))
            throw Error("Routed Manager is no longer available");
        }
        // Replaying a pending assignment in an event must not manufacture authority.
        if (
          previous.pending &&
          action === "goals.assign" &&
          origin.kind === "event"
        )
          throw Error("Reports cannot create goals");
        await this.deliver(monoId, requestId, host);
        return previous.result;
      }
      const projects = await host.projects(monoId);
      const allowed = (id: string) =>
        projects.find(
          (project) =>
            project.id === id || pathKey(project.folder) === pathKey(id),
        );
      if (action === "projects.list")
        return {
          projects: projects.slice(0, 200),
          truncated: projects.length > 200,
        };
      if (action === "projects.status") {
        const project = allowed(text(input.projectId, "projectId", 4096));
        if (!project) throw Error("Not one of this Mono's registered projects");
        return host.status(
          monoId,
          project.id,
          input.before == null ? undefined : text(input.before, "before", 256),
        );
      }
      if (action === "prs.ready")
        return { prs: (await host.ready(monoId)).slice(0, 200) };
      if (Object.keys(ledger.receipts).length >= 4000)
        throw Error(
          "Goal receipt capacity reached; history retained to prevent duplicate dispatch",
        );
      let goal: MonoManagerGoal;
      let message: string;
      if (action === "goals.assign") {
        if (!host.mayDelegate(monoId))
          throw Error(
            "Only the Orchestrator may delegate goals to project Managers",
          );
        if (origin.kind === "event")
          throw Error(
            "Reports cannot create goals; only user messages or user-approved habits can assign work",
          );
        const project = allowed(text(input.projectId, "projectId", 4096));
        if (!project)
          throw Error(
            "Not one of this Mono's registered projects. Ask the user to add it in Mono details.",
          );
        if (route && (!project.managerExists || route.projectId !== project.id || route.managerId !== project.managerId ||
            route.managerMonoId !== undefined && route.managerMonoId !== project.managerMonoId))
          throw Error("Goal route no longer matches its registered project Manager");
        if (ledger.goals.filter((goal) => !terminal(goal.state)).length >= 100)
          throw Error("Finish active goals before adding more");
        message = text(input.goal, "goal");
        goal = {
          id: crypto.randomUUID(),
          monoId,
          projectId: project.id,
          managerId: project.managerId,
          userMessageId: origin.messageId,
          requestId,
          title: message,
          state: "queued",
          prUrls: [],
          createdAt: Date.now(),
          updatedAt: Date.now(),
          ...(route ? { route: { ...route } } : {}),
        };
      } else {
        const existing = ledger.goals.find(
          (goal) => goal.id === text(input.goalId, "goalId", 128),
        );
        if (!existing || !allowed(existing.projectId))
          throw Error(
            "Goal is not owned by this Mono or its project is no longer assigned",
          );
        if (origin.kind === "event" && action !== "goals.message")
          throw Error("Event turns may only message existing goals");
        goal = existing;
        message =
          action === "goals.cancel"
            ? "Cancel this goal. Stop only its workers; retain all worktrees and files."
            : text(input.text, "text");
      }
      const result = {
        goalId: goal.id,
        managerId: goal.managerId,
        accepted: true,
      };
      await this.save(monoId, {
        ...ledger,
        goals:
          action === "goals.assign" ? [...ledger.goals, goal] : ledger.goals,
        receipts: {
          ...ledger.receipts,
          [requestId]: {
            signature,
            result,
            pending: {
              goalId: goal.id,
              text: message,
              cancel: action === "goals.cancel",
              ...(host.requestAuthority ? { request: structuredClone(host.requestAuthority) } : {}),
            },
          },
        },
      });
      await this.deliver(monoId, requestId, host);
      return result;
    });
  }
  reconcile(
    runs: OrchestrationRun[],
    decisions: ReadonlySet<string>,
    statuses: ReadonlyMap<string, GitPr | null>,
  ) {
    return this.serial(async () => {
      const changed: MonoManagerGoal[] = [];
      for (const [id, ledger] of this.ledgers) {
        const goals = ledger.goals.map((goal) => {
          if (terminal(goal.state) || goal.route && ledger.receipts[goal.requestId]?.pending) return goal;
          const run = runs.find((run) => run.leadId === goal.managerId);
          const tasks =
            run?.tasks.filter((task) => task.monoGoalId === goal.id) ?? [];
          const prUrls = tasks.flatMap((task) =>
            task.accepted &&
            task.acceptedDispatchId === task.lastDispatchId &&
            task.prUrl
              ? [task.prUrl]
              : [],
          );
          const state: GoalStatus = decisions.has(
            run?.ownerSessionId ?? goal.managerId,
          )
            ? "needs-you"
              : run?.status === "stopped"
                ? "cancelled"
              : run?.status === "paused" ||
                tasks.some((task) =>
                  ["failed", "blocked", "interrupted"].includes(task.status),
                )
              ? "blocked"
              : tasks.length &&
                  tasks.every((task) => task.status === "cancelled")
                ? "cancelled"
                : tasks.length &&
                    tasks.every(
                      (task) =>
                        task.status === "cancelled" ||
                        managerTaskFinished(
                          task,
                          statuses.get(
                            prStatusKey(
                              task.workspace?.checkoutCwd ?? "",
                              task.workspace?.branch,
                            ),
                          ),
                        ),
                    )
                  ? "done"
                  : tasks.some(
                        (task) =>
                          task.accepted &&
                          task.acceptedDispatchId === task.lastDispatchId &&
                          task.prUrl &&
                          statuses.get(
                            prStatusKey(
                              task.workspace?.checkoutCwd ?? "",
                              task.workspace?.branch,
                            ),
                          )?.state === "open",
                      )
                    ? "ready"
                    : tasks.length
                      ? "running"
                      : run?.status === "active"
                        ? "queued"
                        : goal.state;
          if (
            goal.state === state &&
            JSON.stringify(goal.prUrls) === JSON.stringify(prUrls)
          )
            return goal;
          const next = { ...goal, state, prUrls, updatedAt: Date.now() };
          if (
            ["needs-you", "ready", "blocked", "done", "cancelled"].includes(
              state,
            )
          )
            changed.push(next);
          return next;
        });
        if (goals.some((goal, index) => goal !== ledger.goals[index])) {
          const old = new Set(
            goals
              .filter((goal) => terminal(goal.state))
              .sort((a, b) => b.updatedAt - a.updatedAt)
              .slice(100)
              .map((goal) => goal.id),
          );
          await this.save(id, {
            ...ledger,
            events: {
              ...ledger.events,
              ...Object.fromEntries(
                changed
                  .filter((goal) => goal.monoId === id && !runs.some(run => run.leadId === goal.managerId && run.ownerMonoId === id))
                  .map((goal) => [goal.id, goal]),
              ),
            },
            goals: goals.map((goal) =>
              old.has(goal.id)
                ? { ...goal, archived: true, title: goal.title.slice(0, 160) }
                : goal,
            ),
          });
        }
      }
      return changed;
    });
  }
}
export const monoManagerGoals = new MonoManagerGoals();
export const monoGoalOrigins = new Map<string, GoalOrigin>();
