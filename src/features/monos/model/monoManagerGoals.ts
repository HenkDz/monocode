import { invoke } from "@tauri-apps/api/core";
import { pathKey } from "../../../shared/lib/paths";
import type { OrchestrationRun } from "../../orchestration/model/orchestration";
import { managerTaskFinished } from "../../orchestration/model/projectManager";
import { prStatusKey } from "../../source-control/hooks/usePrStatus";
import type { GitPr } from "../../../platform/tauri/fs";

export const MANAGER_ACTIONS = ["projects.list", "projects.status", "goals.assign", "goals.message", "goals.cancel", "prs.ready"] as const;
export type GoalStatus = "queued" | "running" | "needs-you" | "ready" | "done" | "cancelled" | "blocked";
export type MonoManagerGoal = {
  id: string; monoId: string; projectId: string; managerId: string;
  userMessageId: string; requestId: string; title: string;
  state: GoalStatus; prUrls: string[]; createdAt: number; updatedAt: number;
  archived?: boolean;
};
type Receipt = { signature: string; result: unknown; pending?: { goalId: string; text: string; cancel?: boolean } };
export type GoalLedger = { version: 1; goals: MonoManagerGoal[]; receipts: Record<string, Receipt>; events?: Record<string, MonoManagerGoal> };
export type GoalOrigin = { kind: "user" | "habit" | "event"; messageId: string };
export type ManagerProject = { id: string; name: string; folder: string; branch?: string; managerId: string; managerExists: boolean; running: number; needsDecision: number; ready: number; blocked: string[]; goals: string[] };
export type ManagerReadyPr = { goalId?: string; projectId: string; project: string; managerId: string; taskId: string; title: string; branch: string; url: string; cwd: string; checks: string };
export type ManagerGoalHost = {
  mayDelegate(monoId: string): boolean;
  projects(monoId: string): Promise<ManagerProject[]>;
  status(monoId: string, projectId: string, before?: string): Promise<unknown>;
  ready(monoId: string): Promise<ManagerReadyPr[]>;
  deliver(goal: MonoManagerGoal, text: string, receiptId: string, cancel: boolean): Promise<void>;
};
type Store = { load(id: string): Promise<GoalLedger | null>; save(id: string, ledger: GoalLedger): Promise<void> };
const store: Store = {
  load: async id => { const raw = await invoke<string | null>("control_load", { leadId: `mono-goals:${id}` }); return raw ? JSON.parse(raw) : null; },
  save: (id, ledger) => invoke("control_save", { leadId: `mono-goals:${id}`, state: JSON.stringify(ledger) }),
};
const terminal = (state: GoalStatus) => state === "done" || state === "cancelled";
const text = (value: unknown, label: string, max = 8000) => {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw Error(`Invalid ${label}`);
  return value.trim();
};
const fields: Record<string, string[]> = { "projects.list": [], "projects.status": ["projectId", "before"], "goals.assign": ["projectId", "goal"], "goals.message": ["goalId", "text"], "goals.cancel": ["goalId"], "prs.ready": [] };

/** Durable receipts precede manager delivery. A retry replays only the undelivered outbox entry. */
export class MonoManagerGoals {
  private ledgers = new Map<string, GoalLedger>();
  // ponytail: serialize the small app-wide ledger; split by Mono if dispatch throughput warrants it.
  private tail: Promise<unknown> = Promise.resolve();
  private listeners = new Set<() => void>();
  private revision = 0;
  constructor(private storage: Store = store) {}
  snapshot = () => this.revision;
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  goals(id?: string) { return id ? this.ledgers.get(id)?.goals ?? [] : [...this.ledgers.values()].flatMap(ledger => ledger.goals); }
  private serial<T>(fn: () => Promise<T>): Promise<T> { const next = this.tail.then(fn); this.tail = next.catch(() => undefined); return next; }
  private async load(id: string) {
    if (this.ledgers.has(id)) return this.ledgers.get(id)!;
    const ledger = await this.storage.load(id) ?? { version: 1 as const, goals: [], receipts: {} };
    if (ledger.version !== 1 || !Array.isArray(ledger.goals) || !ledger.receipts || typeof ledger.receipts !== "object" || Array.isArray(ledger.receipts)
      || ledger.goals.some(goal => goal.monoId !== id || typeof goal.id !== "string" || typeof goal.managerId !== "string")) throw Error("Unsupported Mono goal history");
    this.ledgers.set(id, ledger); this.changed(); return ledger;
  }
  hydrate(id: string) { return this.serial(() => this.load(id)); }
  events(id: string) { return Object.values(this.ledgers.get(id)?.events ?? {}); }
  acknowledgeEvents(id: string, events: MonoManagerGoal[]) {
    return this.serial(async () => {
      const ledger = await this.load(id);
      const pending = { ...ledger.events };
      for (const event of events) if (pending[event.id]?.updatedAt === event.updatedAt) delete pending[event.id];
      await this.save(id, { ...ledger, events: pending });
    });
  }
  private changed() { this.revision++; this.listeners.forEach(fn => fn()); }
  private async save(id: string, ledger: GoalLedger) {
    if (new TextEncoder().encode(JSON.stringify(ledger)).length > 7_000_000) throw Error("Goal history capacity reached; existing work is retained");
    await this.storage.save(id, ledger); this.ledgers.set(id, ledger); this.changed();
  }
  private async deliver(id: string, requestId: string, host: ManagerGoalHost) {
    const ledger = this.ledgers.get(id)!;
    const receipt = ledger.receipts[requestId];
    if (!receipt.pending) return;
    const goal = ledger.goals.find(goal => goal.id === receipt.pending!.goalId);
    if (!goal) throw Error("Goal receipt references missing state");
    await host.deliver(goal, receipt.pending.text, `mono-goal-${id}-${requestId}`, !!receipt.pending.cancel);
    await this.save(id, { ...ledger,
      goals: receipt.pending.cancel ? ledger.goals.map(entry => entry.id === goal.id ? { ...entry, state: "cancelled" as const, updatedAt: Date.now() } : entry) : ledger.goals,
      receipts: { ...ledger.receipts, [requestId]: { signature: receipt.signature, result: receipt.result } } });
  }
  recover(id: string, host: ManagerGoalHost) {
    return this.serial(async () => {
      const ledger = await this.load(id);
      for (const [requestId, receipt] of Object.entries(ledger.receipts)) if (receipt.pending) await this.deliver(id, requestId, host);
    });
  }
  handle(monoId: string, origin: GoalOrigin | undefined, requestId: string, action: string, input: Record<string, unknown>, host: ManagerGoalHost) {
    return this.serial(async () => {
      if (!origin) throw Error("No active Mono or user-approved habit turn");
      if (!Object.prototype.hasOwnProperty.call(fields, action) || Object.keys(input).some(key => !fields[action].includes(key))) throw Error("Unknown Manager action or input field");
      if (!/^[A-Za-z0-9_-]{1,128}$/.test(requestId)) throw Error("Invalid requestId");
      const ledger = await this.load(monoId);
      const signature = JSON.stringify([action, Object.entries(input).sort(([a], [b]) => a.localeCompare(b))]);
      const previous = Object.prototype.hasOwnProperty.call(ledger.receipts, requestId) ? ledger.receipts[requestId] : undefined;
      if (previous) {
        if (previous.signature !== signature) throw Error("Request ID already used with different input");
        const owned = ledger.goals.find(goal => goal.requestId === requestId || goal.id === previous.pending?.goalId);
        if (owned && !(await host.projects(monoId)).some(project => project.id === owned.projectId)) throw Error("Project is no longer assigned to this Mono");
        // Replaying a pending assignment in an event must not manufacture authority.
        if (previous.pending && action === "goals.assign" && origin.kind === "event") throw Error("Reports cannot create goals");
        await this.deliver(monoId, requestId, host); return previous.result;
      }
      const projects = await host.projects(monoId);
      const allowed = (id: string) => projects.find(project => project.id === id || pathKey(project.folder) === pathKey(id));
      if (action === "projects.list") return { projects: projects.slice(0, 200), truncated: projects.length > 200 };
      if (action === "projects.status") {
        const project = allowed(text(input.projectId, "projectId", 4096));
        if (!project) throw Error("Not one of this Mono's registered projects");
        return host.status(monoId, project.id, input.before == null ? undefined : text(input.before, "before", 256));
      }
      if (action === "prs.ready") return { prs: (await host.ready(monoId)).slice(0, 200) };
      if (Object.keys(ledger.receipts).length >= 4000) throw Error("Goal receipt capacity reached; history retained to prevent duplicate dispatch");
      let goal: MonoManagerGoal;
      let message: string;
      if (action === "goals.assign") {
        if (!host.mayDelegate(monoId)) throw Error("Only multi-project Monos may delegate goals; use this Mono's worker engine instead");
        if (origin.kind === "event") throw Error("Reports cannot create goals; only user messages or user-approved habits can assign work");
        const project = allowed(text(input.projectId, "projectId", 4096));
        if (!project) throw Error("Not one of this Mono's registered projects. Ask the user to add it in Mono details.");
        if (ledger.goals.filter(goal => !terminal(goal.state)).length >= 100) throw Error("Finish active goals before adding more");
        message = text(input.goal, "goal");
        goal = { id: crypto.randomUUID(), monoId, projectId: project.id, managerId: project.managerId, userMessageId: origin.messageId, requestId, title: message, state: "queued", prUrls: [], createdAt: Date.now(), updatedAt: Date.now() };
      } else {
        const existing = ledger.goals.find(goal => goal.id === text(input.goalId, "goalId", 128));
        if (!existing || !allowed(existing.projectId)) throw Error("Goal is not owned by this Mono or its project is no longer assigned");
        if (origin.kind === "event" && action !== "goals.message") throw Error("Event turns may only message existing goals");
        goal = existing;
        message = action === "goals.cancel" ? "Cancel this goal. Stop only its workers; retain all worktrees and files." : text(input.text, "text");
      }
      const result = { goalId: goal.id, managerId: goal.managerId, accepted: true };
      await this.save(monoId, { ...ledger, goals: action === "goals.assign" ? [...ledger.goals, goal] : ledger.goals, receipts: { ...ledger.receipts, [requestId]: { signature, result, pending: { goalId: goal.id, text: message, cancel: action === "goals.cancel" } } } });
      await this.deliver(monoId, requestId, host);
      return result;
    });
  }
  reconcile(runs: OrchestrationRun[], decisions: ReadonlySet<string>, statuses: ReadonlyMap<string, GitPr | null>) {
    return this.serial(async () => {
      const changed: MonoManagerGoal[] = [];
      for (const [id, ledger] of this.ledgers) {
        const goals = ledger.goals.map(goal => {
          if (terminal(goal.state)) return goal;
          const run = runs.find(run => run.leadId === goal.managerId);
          const tasks = run?.tasks.filter(task => task.monoGoalId === goal.id) ?? [];
          const prUrls = tasks.flatMap(task => task.accepted && task.acceptedDispatchId === task.lastDispatchId && task.prUrl ? [task.prUrl] : []);
          const state: GoalStatus = decisions.has(run?.ownerSessionId ?? goal.managerId) ? "needs-you"
            : run?.status === "paused" || tasks.some(task => ["failed", "blocked", "interrupted"].includes(task.status)) ? "blocked"
            : tasks.length && tasks.every(task => task.status === "cancelled") ? "cancelled"
            : tasks.length && tasks.every(task => task.status === "cancelled" || managerTaskFinished(task, statuses.get(prStatusKey(task.workspace?.checkoutCwd ?? "", task.workspace?.branch)))) ? "done"
            : tasks.some(task => task.accepted && task.acceptedDispatchId === task.lastDispatchId && task.prUrl && statuses.get(prStatusKey(task.workspace?.checkoutCwd ?? "", task.workspace?.branch))?.state === "open") ? "ready"
            : tasks.length ? "running" : goal.state;
          if (goal.state === state && JSON.stringify(goal.prUrls) === JSON.stringify(prUrls)) return goal;
          const next = { ...goal, state, prUrls, updatedAt: Date.now() };
          if (["needs-you", "ready", "blocked", "done", "cancelled"].includes(state)) changed.push(next);
          return next;
        });
        if (goals.some((goal, index) => goal !== ledger.goals[index])) {
          const old = new Set(goals.filter(goal => terminal(goal.state)).sort((a,b) => b.updatedAt - a.updatedAt).slice(100).map(goal => goal.id));
          await this.save(id, { ...ledger,
            events: { ...ledger.events, ...Object.fromEntries(changed.filter(goal => goal.monoId === id).map(goal => [goal.id, goal])) },
            goals: goals.map(goal => old.has(goal.id) ? { ...goal, archived: true, title: goal.title.slice(0,160) } : goal) });
        }
      }
      return changed;
    });
  }
}
export const monoManagerGoals = new MonoManagerGoals();
export const monoGoalOrigins = new Map<string, GoalOrigin>();
