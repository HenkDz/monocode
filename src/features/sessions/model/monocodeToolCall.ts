import { unwrapShellCommand } from "../../../integrations/harness/core/shellIntent";
import { projectName } from "../../../shared/lib/paths";
import { presentationText } from "./transcriptPresentation";
import type { Block } from "./session";

export type MonoCodeToolCall = {
  action: string;
  label: string;
  command: string;
  input?: Record<string, unknown>;
  topic?: string;
};

const ACTION_LABELS: Record<string, string> = {
  rules: "Read app guidance",
  "tasks.request": "Request a task",
  "team.answer": "Answer a teammate",
  "team.list": "List teammates",
  "team.message": "Send a team message",
  "team.hire": "Hire a teammate",
  "team.update": "Update a teammate",
  "team.memory.add": "Save a team fact",
  "team.memory.forget": "Remove a team fact",
  "team.retire": "Retire a teammate",
  "reviews.submit": "Submit a review",
  "projects.list": "List projects",
  "projects.status": "Read project status",
  "goals.assign": "Assign a goal",
  "goals.message": "Send a goal update",
  "goals.cancel": "Cancel a goal",
  "prs.ready": "Read ready pull requests",
  "models.list": "List models",
  "sessions.list": "List sessions",
  "sessions.read": "Read a session",
  "sessions.send": "Continue a session",
  "sessions.draft": "Save a draft",
  "sessions.start": "Start a session",
  "sessions.stop": "Stop a session",
  "sessions.archive": "Archive a session",
  "sessions.delete": "Delete a session",
  "worktrees.list": "List worktrees",
  "worktrees.create": "Create a worktree",
  "folders.list": "List folders",
  "folders.move": "Move a session",
  "notes.list": "List notes",
  "notes.read": "Read a note",
  "notes.write": "Write a note",
  "artifacts.list": "List artifacts",
  "artifacts.read": "Read an artifact",
  "artifacts.write": "Write an artifact",
  "soul.read": "Read instructions",
  "soul.update": "Update instructions",
  "memory.read": "Read memory",
  "memory.search": "Search memory",
  "memory.add": "Save a fact",
  "memory.replace": "Replace a fact",
  "memory.remove": "Remove a fact",
  "habits.list": "List habits",
  "habits.add": "Add a habit",
  "habits.update": "Update a habit",
  "habits.run": "Run a habit",
  "habits.remove": "Remove a habit",
  "chat.card": "Post a chat card",
};

/** Conservatively parse one shell invocation; compound commands use the shell row. */
function shellWords(command: string): string[] | undefined {
  const words: string[] = [];
  let word = "";
  let started = false;
  let quote: "'" | '"' | null = null;
  for (let index = 0; index < command.length; index += 1) {
    const char = command[index];
    if (quote === "'") {
      if (char === "'") quote = null;
      else word += char;
      continue;
    }
    if (char === "'" && !quote) {
      quote = "'";
      started = true;
      continue;
    }
    if (char === '"') {
      quote = quote === '"' ? null : '"';
      started = true;
      continue;
    }
    if (char === "\\") {
      const next = command[index + 1];
      if (!next) return undefined;
      // Preserve ordinary path separators, including quoted Windows paths.
      if (
        (quote === '"' && !/[\\"$`]/.test(next)) ||
        (!quote && !/[\s'"\\;&|<>()[\]{}$`#]/.test(next))
      ) {
        word += char;
      } else {
        word += next;
        index += 1;
      }
      started = true;
      continue;
    }
    if (char === "$" || char === "`") return undefined;
    if (!quote && /[\r\n;&|<>()[\]{}#]/.test(char)) return undefined;
    if (!quote && /\s/.test(char)) {
      if (started) words.push(word);
      word = "";
      started = false;
      continue;
    }
    word += char;
    started = true;
  }
  if (quote) return undefined;
  if (started) words.push(word);
  return words;
}

/** Recognize the actual app CLI command, not a mention of it in prose/output. */
export function monoCodeToolCall(block: Block): MonoCodeToolCall | undefined {
  if (block.role !== "tool" && block.role !== "approval") return undefined;
  // A shell preview retains the original command when the display title was
  // simplified. Never accept a shorter title in place of that command.
  const candidate =
    (block.tool?.preview?.kind === "shell"
      ? block.tool.preview.title
      : undefined) ??
    block.tool?.title ??
    block.text;
  const command = candidate?.trim().replace(/^Run(?:ning)?\s+command:\s*/i, "");
  if (!command) return undefined;
  let unwrapped = unwrapShellCommand(command);
  // These wrappers affect presentation only, never the app CLI approval policy.
  unwrapped = unwrapped.replace(/^(?:"[^"\r\n]*[/\\]|'[^'\r\n]*[/\\]|[^\s"']*[/\\])?rtk(?:\.exe)?["']?\s+(?:proxy\s+)?/i, "");
  unwrapped = unwrapShellCommand(unwrapped).replace(/^&\s+(?=['"])/, "");
  const words = shellWords(unwrapped);
  if (!words || !/(?:^|[/\\])monocode(?:-[\w-]+)?(?:\.exe)?$/i.test(words[0] ?? ""))
    return undefined;
  if (words[1] !== "app") return undefined;
  const action = words[2] ?? "--help";
  if (action === "--help" || action === "help" || action === "-h") {
    return words.length > 3
      ? undefined
      : { action: "--help", label: "View CLI commands", command };
  }
  if (!Object.prototype.hasOwnProperty.call(ACTION_LABELS, action))
    return undefined;
  if (action === "rules") {
    return words.length === 4 && ["team", "shell", "artifacts", "delegation", "memory", "habits", "--help"].includes(words[3])
      ? { action, label: ACTION_LABELS[action], command, topic: words[3] }
      : undefined;
  }
  let input: Record<string, unknown> | undefined;
  for (let index = 3; index < words.length; index += 2) {
    if (
      !["--json", "--input", "--request-id"].includes(words[index]) ||
      !words[index + 1]
    )
      return undefined;
    if (words[index] === "--json") input = outputRecord(words[index + 1]);
  }
  return { action, label: ACTION_LABELS[action], command, ...(input ? { input } : {}) };
}

function outputRecord(text?: string): Record<string, unknown> | undefined {
  try {
    return asRecord(JSON.parse(text ?? ""));
  } catch {
    return undefined;
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function summaryName(...values: unknown[]): string | undefined {
  const value = values.find((entry) => typeof entry === "string" && entry.trim());
  return typeof value === "string"
    ? presentationText(value).replace(/\s+/g, " ").trim().slice(0, 100) || undefined
    : undefined;
}

/** Receipts supply names and counts; conversation bodies never become card text. */
export function monoCodeToolSummary(call: MonoCodeToolCall, output?: string, completed = true, nameFor?: (id: string) => string | undefined): string {
  if (call.action === "rules") return `Read ${call.topic === "--help" ? "app" : call.topic} guidance`;
  const receipt = outputRecord(output);
  if (!completed || receipt?.ok !== true) return call.label;
  const result = asRecord(receipt.result) ?? {};
  const session = asRecord(result.session);
  const input = call.input ?? {};
  const knownName = (...ids: unknown[]) => summaryName(...ids.map(id => typeof id === "string" ? nameFor?.(id) : undefined));
  const conversation = summaryName(result.title, result.name, session?.title, knownName(result.sessionId, input.sessionId)) ?? "session";
  switch (call.action) {
    case "sessions.read": {
      const count = Array.isArray(result.turns) ? result.turns.length : undefined;
      return `Read ${conversation} conversation${count === undefined ? "" : ` · ${count} recent exchange${count === 1 ? "" : "s"}`}`;
    }
    case "sessions.list": {
      const count = Array.isArray(result.sessions) ? result.sessions.length : undefined;
      return count === undefined ? "Listed sessions" : `Listed ${count} session${count === 1 ? "" : "s"}`;
    }
    case "sessions.send":
      return result.queued === true ? `Queued message to ${conversation}` : result.submitted === true ? `Sent message to ${conversation}` : "Read session delivery receipt";
    case "team.message": {
      const recipient = summaryName(result.recipientName, result.memberName, knownName(input.memberId, result.routedTo)) ?? "teammate";
      const topic = summaryName(input.topic);
      return result.sent === true ? `Sent team message to ${recipient}${topic ? `: “${topic}”` : ""}` : "Read team message receipt";
    }
    case "goals.assign": {
      if (result.accepted !== true && result.assigned !== true) return "Read goal assignment receipt";
      const project = typeof input.projectId === "string" && !/^(?:mono-|app-)|^[\da-f]{8}-[\da-f-]{27,}$/i.test(input.projectId) ? projectName(input.projectId) : undefined;
      const manager = summaryName(result.managerName, result.projectName, knownName(result.managerId, input.projectId), project);
      return `Assigned goal${manager ? ` to ${manager}${/manager$/i.test(manager) ? "" : " Manager"}` : " to Manager"}`;
    }
    case "tasks.request": {
      const title = summaryName(result.title, input.title);
      return `Requested task${title ? `: ${title}` : ""}`;
    }
    case "artifacts.read": {
      const title = summaryName(result.title, input.id);
      return `Read artifact${title ? `: ${title}` : ""}`;
    }
    default:
      return call.label;
  }
}

/** A group of only MonoCode calls can be named for the app, not the shell. */
export function monoCodeWorkSummary(
  steps: Block[],
  live: boolean,
): string | undefined {
  if (steps.some((block) => block.interjection || block.role === "system")) {
    return undefined;
  }
  const calls = steps.filter(
    (block) => block.role === "tool" || block.role === "approval",
  );
  if (calls.length === 0 || calls.some((block) => !monoCodeToolCall(block))) {
    return undefined;
  }
  return live ? "Using MonoCode" : "Used MonoCode";
}
