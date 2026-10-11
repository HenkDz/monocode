import { projectKey } from "../../../shared/lib/paths";
import type { Mono, MonoProject } from "./mono";
import type { Session } from "../../sessions/model/session";
import type {
  ManagerGoalHost,
  ManagerProject,
  MonoManagerGoal,
  MonoManagerGoals,
} from "./monoManagerGoals";

export type MonoGoalProject = {
  id: string;
  name: string;
  path: string;
  managerMonoId?: string;
  available: boolean;
};
export type MonoGoalRoutingContext = {
  ownerId: string;
  projects: MonoGoalProject[];
};
export type MonoGoalRouteChoice = {
  mode: "chat" | "goal";
  override: "auto" | "grand" | "manager";
  projectId?: string;
};
export type MonoGoalSubmission = {
  ownerId: string;
  choice: MonoGoalRouteChoice;
  projectId?: string;
  managerMonoId?: string;
  reason: string;
  requestId: string;
  userMessageId: string;
};
export type MonoGoalRouteDecision =
  | { kind: "grand"; reason: string }
  | { kind: "manager"; project: MonoGoalProject; reason: string };

/** Include unavailable identities so a second project mention cannot disappear. */
export function monoGoalRoutingContext(
  owner: Mono,
  roster: readonly Mono[],
  projects: readonly MonoProject[],
  unavailablePaths: readonly string[] = [],
): MonoGoalRoutingContext {
  const unique = new Map(projects.map(project => [projectKey(project.path), project]));
  return {
    ownerId: owner.id,
    projects: [...unique].map(([id, project]) => {
      const managers = roster.filter(member => member.role === "manager" &&
        member.archivedAt == null && member.reportsTo === owner.id &&
        member.projects.length === 1 && projectKey(member.projects[0]) === id);
      return {
        id, name: project.name, path: project.path,
        managerMonoId: managers.length === 1 ? managers[0].id : undefined,
        available: owner.role === "orchestrator" && owner.archivedAt == null &&
          managers.length === 1 && !unavailablePaths.some(path => projectKey(path) === id),
      };
    }),
  };
}

type Mention = { id: string; start: number; end: number };
function mentions(text: string, projects: readonly MonoGoalProject[]): Mention[] {
  const haystack = text.toLowerCase();
  const found: Mention[] = [];
  for (const project of projects) {
    if (!project.name) continue;
    const needle = project.name.toLowerCase();
    let start = haystack.indexOf(needle);
    while (start >= 0) {
      const end = start + needle.length;
      const boundary = /[\p{L}\p{N}_./\\-]/u;
      const before = haystack[start - 1];
      const after = haystack[end];
      const drivePrefix = /^[a-z]:$/i.test(haystack.slice(start - 2, start));
      if (!drivePrefix && (!before || !boundary.test(before)) && (!after || !boundary.test(after)))
        found.push({ id: project.id, start, end });
      start = haystack.indexOf(needle, end);
    }
  }
  return found.filter(mention => !found.some(other =>
    other.start <= mention.start && other.end >= mention.end &&
    (other.start < mention.start || other.end > mention.end)));
}

export function decideMonoGoalRoute(input: {
  text: string;
  attachmentCount: number;
  choice: MonoGoalRouteChoice;
  context: MonoGoalRoutingContext;
}): MonoGoalRouteDecision {
  const grand = (reason: string): MonoGoalRouteDecision => ({ kind: "grand", reason });
  const { text, attachmentCount, choice, context } = input;
  if (choice.mode !== "goal") return grand("Chat stays with Grand Orchestrator");
  if (choice.override === "grand") return grand("Grand Orchestrator selected");
  if (attachmentCount) return grand("Attachments need the full Grand submission");
  if (!text.trim() || text.length > 8000) return grand("Goals must contain 1–8,000 characters");
  const hasPaths = (text.match(/[^\s"'`()\[\]{}<>]+/g) ?? []).some(token =>
    /[/\\]|^[a-z]:|^\.{1,2}$|^\.[\p{L}\p{N}_-]|[\p{L}\p{N}_-]\.[\p{L}\p{N}_-]/iu.test(token));
  if (hasPaths && choice.override !== "manager")
    return grand("Contains file paths: choose a project or send to Grand Orchestrator");
  if (/\b(compare|compares|compared|comparing|comparisons?|versus|vs\.?|cross[- ]project)\b|\b(across|all|both|multiple|between)\s+(the\s+)?(projects|repositories|repos)\b/i.test(text))
    return grand("Comparison or cross-project goal");
  const matches = mentions(text, context.projects);
  const selected = choice.override === "manager" ? choice.projectId : matches[0]?.id;
  if (!selected) return grand("Choose a project or mention its exact name");
  const normalize = (value: string) => value.toLowerCase().replace(/[\p{P}\s]/gu, "");
  const normalizedText = normalize(text);
  // Conflict checks deliberately over-block substrings, including unavailable project names.
  const referenced = context.projects.filter(project => normalizedText.includes(normalize(project.name)));
  if (referenced.some(project => project.id !== selected))
    return grand(referenced.some(project => project.id === selected)
      ? "More than one project mentioned" : "Selected project differs from the text");
  const project = context.projects.find(project => project.id === selected);
  if (!project?.available || !project.managerMonoId)
    return grand("Project has no available local Manager");
  return { kind: "manager", project,
    reason: hasPaths ? `Contains file paths: routed to ${project.name} because you selected it`
      : choice.override === "manager" ? "Project selected" : "Exact project name" };
}

export type MonoGoalSubmitHost = {
  context(): MonoGoalRoutingContext;
  resolve(project: MonoGoalProject): Promise<ManagerProject | undefined>;
  ledger: MonoManagerGoals;
  goals: ManagerGoalHost;
  persistOrigin(submission: MonoGoalSubmission, text: string): Promise<void>;
  hasOrigin(submission: MonoGoalSubmission): boolean | Promise<boolean>;
  persistPending(submission: MonoGoalSubmission, error: unknown): Promise<void>;
  persistCard(submission: MonoGoalSubmission, goal: MonoManagerGoal): Promise<void>;
  grand(): boolean | Promise<boolean>;
};

export function appendMonoGoalOrigin(session: Session, submission: MonoGoalSubmission, text: string): Session {
  const signature = (value?: MonoGoalSubmission) => value && JSON.stringify([
    value.ownerId, value.requestId, value.userMessageId, value.reason, value.projectId,
    value.managerMonoId, value.choice.mode, value.choice.override, value.choice.projectId,
  ]);
  const previous = session.blocks.find(block => block.id === submission.userMessageId);
  if (previous) {
    if (previous.role !== "user" || previous.text !== text ||
        signature(previous.monoGoalSubmission) !== signature(submission))
      throw Error("Goal message identity already used with different input");
    return session;
  }
  return { ...session, blocks: [...session.blocks, {
    id: submission.userMessageId, role: "user", text, sentAt: Date.now(),
    monoGoalSubmission: submission,
  }] };
}

export function appendMonoGoalCard(session: Session, submission: MonoGoalSubmission, goal: MonoManagerGoal): Session {
  const id = `route-${submission.userMessageId}`;
  if (session.blocks.some(block => block.id === id && block.monoCard)) return session;
  const card: Session["blocks"][number] = {
    id, role: "assistant", text: `Goal sent to the project Manager · ${goal.route?.reason ?? submission.reason}`,
    monoCard: { type: "dispatch", goalIds: [goal.id] }, monoCardOwner: goal.monoId,
  };
  const origin = session.blocks.findIndex(block => block.id === submission.userMessageId && block.role === "user");
  const position = origin < 0 ? session.blocks.length : origin + 1;
  return { ...session, blocks: session.blocks.some(block => block.id === id)
    ? session.blocks.map(block => block.id === id ? card : block)
    : [...session.blocks.slice(0, position), card, ...session.blocks.slice(position)] };
}

export function appendMonoGoalPendingCard(session: Session, submission: MonoGoalSubmission, error: unknown): Session {
  const id = `route-${submission.userMessageId}`;
  if (session.blocks.some(block => block.id === id)) return session;
  return { ...session, blocks: [...session.blocks, {
    id, role: "assistant", text: `Goal retained for its selected Manager · Delivery blocked: ${error instanceof Error ? error.message : String(error)}. The original request will retry; it has not been sent to Grand Orchestrator.`,
  }] };
}

/** UI-origin work uses the same authority and outbox as goals.assign. */
export async function submitMonoGoal(input: {
  text: string;
  attachmentCount: number;
  origin: "user" | "event" | "habit";
  submission: MonoGoalSubmission;
  recovery?: boolean;
}, host: MonoGoalSubmitHost): Promise<boolean> {
  const { submission, text } = input;
  if (input.origin !== "user") throw Error("Only a user submission can route a new goal");
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(submission.requestId) ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(submission.userMessageId) ||
      submission.ownerId !== host.context().ownerId)
    throw Error("Invalid goal submission identity");
  const ownerId = submission.ownerId;
  const pending = async (error: unknown) => {
    await host.persistPending(submission, error).catch(error =>
      console.error("Mono goal origin retained for recovery", error));
    return true;
  };
  const accepted = async (goal: MonoManagerGoal) => {
    await host.persistCard(submission, goal).catch(error =>
      console.error("Mono goal accepted; route card retained for recovery", error));
    return true;
  };
  const fallback = async () => {
    if (await host.hasOrigin(submission)) return pending(Error("The original project route is unavailable"));
    if (input.recovery) throw Error("Goal route unavailable; retained the original request");
    // A stale Manager envelope must refresh its chip before a new Send can use Grand.
    if (submission.projectId) return false;
    return host.grand();
  };
  await host.ledger.hydrate(ownerId);
  const previous = host.ledger.goals(ownerId).find(goal => goal.requestId === submission.requestId);
  if (previous) {
    if (!previous.route || previous.userMessageId !== submission.userMessageId ||
        previous.title !== text.trim() || input.attachmentCount !== 0 || submission.choice.mode !== "goal" ||
        previous.route.override !== submission.choice.override ||
        previous.route.reason !== submission.reason)
      throw Error("Goal request identity already used with different input");
    await host.persistOrigin(submission, text);
    try {
      if (host.ledger.deliveryPending(ownerId, submission.requestId))
        await host.ledger.handle(ownerId, { kind: "user", messageId: submission.userMessageId },
          submission.requestId, "goals.assign", { projectId: previous.projectId, goal: text }, host.goals, previous.route);
    } catch (error) {
      if (error instanceof Error && error.message === "Request ID already used with different input") throw error;
      if (!host.ledger.deliveryPending(ownerId, submission.requestId)) throw error;
    }
    return accepted(previous);
  }
  const decide = () => decideMonoGoalRoute({ text, attachmentCount: input.attachmentCount,
    choice: submission.choice, context: host.context() });
  const decision = decide();
  if (decision.kind === "grand") return fallback();
  if (decision.project.id !== submission.projectId ||
      decision.project.managerMonoId !== submission.managerMonoId) return fallback();
  const project = await host.resolve(decision.project);
  const latest = decide();
  if (!project?.managerExists || project.managerMonoId !== submission.managerMonoId || latest.kind !== "manager" ||
      latest.project.id !== decision.project.id ||
      latest.project.managerMonoId !== decision.project.managerMonoId) return fallback();
  if (!host.goals.mayDelegate(ownerId))
    throw Error("Only the Orchestrator may delegate goals to project Managers");
  await host.persistOrigin(submission, text);
  // Recheck after origin persistence and inside the ledger's serialized boundary.
  const goals: ManagerGoalHost = {
    ...host.goals,
    projects: async id => {
      const registered = await host.goals.projects(id);
      const current = decide();
      if (id !== ownerId || current.kind !== "manager" ||
          current.project.id !== decision.project.id ||
          current.project.managerMonoId !== submission.managerMonoId)
        throw Error("Goal route changed; retained the original request");
      return registered.filter(entry => entry.id === project.id && entry.managerId === project.managerId);
    },
  };
  try {
    await host.ledger.handle(ownerId, { kind: "user", messageId: submission.userMessageId },
      submission.requestId, "goals.assign", { projectId: project.id, goal: text }, goals, {
        sourceUserMessageId: submission.userMessageId, projectId: project.id,
        managerId: project.managerId, reason: decision.reason,
        managerMonoId: decision.project.managerMonoId,
        override: submission.choice.override === "manager" ? "manager" : "auto",
      });
  } catch (error) {
    if (error instanceof Error && error.message === "Request ID already used with different input") throw error;
    const goal = host.ledger.goals(ownerId).find(goal => goal.requestId === submission.requestId);
    return goal ? accepted(goal) : pending(error);
  }
  const goal = host.ledger.goals(ownerId).find(goal => goal.requestId === submission.requestId)!;
  return accepted(goal);
}
