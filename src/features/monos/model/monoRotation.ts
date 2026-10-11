import type { Block, Session } from "../../sessions/model/session";
import {
  canRotateContext,
  rotationInputGrowth,
  taskContextBudget,
} from "../../orchestration/model/taskContextBudget";
import { forgetAgentContext } from "./monoFiles";

/**
 * A Mono's chat never ends, but the provider session behind it does. A safe
 * idle boundary can start a fresh provider session before compaction.
 * That session gets the soul and memory (see `monoFiles`)
 * plus a brief of where the conversation was: recent exchanges word for word
 * and a line for each earlier one. Nothing is summarized by a model, so a
 * rotation costs nothing and the brief never drifts into a summary of a
 * summary; the full transcript stays in the chat for the Mono to read.
 */

/** Recent exchanges carried word for word. */
const VERBATIM_EXCHANGES = 2;
const VERBATIM_USER_CHARS = 2_000;
const VERBATIM_REPLY_CHARS = 3_000;
/** Earlier exchanges carried as one line each, newest kept. */
const LINE_CHARS = 280;
const EARLIER_CHARS = 3_000;

export type RotationReason = "context";

/** What the latest rotation started the provider session with. */
export type MonoRotation = {
  at: number;
  /** Preserve saved briefs from older rotation policies. */
  reason: RotationReason | "idle" | "restart";
  /** The last block the replaced session saw; the fresh one takes it from here. */
  afterBlockId?: string;
  /** One line per exchange before the verbatim ones, oldest first. */
  earlier: string[];
  /** Original user requests are retained verbatim, including older constraints. */
  userRequests?: { id: string; text: string }[];
  references?: string[];
  /** Retried until an actual provider turn accepts the brief. */
  pendingBrief?: string;
  pendingInput?: string;
  pendingInputs?: string[];
};

type Exchange = {
  id: string;
  at?: number;
  user: string;
  reply: string;
  /** Posted by this habit on its own, with no user message before it. */
  habit?: string;
  completion?: string;
  continuation?: boolean;
};

/** Whether the next turn should start a fresh provider session, and why. */
export function rotationReason(
  session: Pick<Session, "providerSessionId" | "context" | "blocks"> &
    Partial<Session>,
  nextText = "",
): RotationReason | undefined {
  // Nothing to rotate: the next turn already starts a new session.
  if (!session.providerSessionId) return undefined;
  return canRotateContext(session) &&
    taskContextBudget(
      session.context,
      rotationInputGrowth(session.blocks, nextText),
    ).rotate
    ? "context"
    : undefined;
}

/** Bounded evidence can be clipped; original user constraints cannot. */
export function planSessionRotation(
  session: Pick<Session, "id" | "providerSessionId" | "context" | "blocks"> &
    Partial<Session>,
  nextText = "",
  taskContext = "",
): ReturnType<typeof planRotation> | undefined {
  return sessionRotationStatus(session, nextText, taskContext).plan;
}

/** The chat and submission use the same bounds and deferral explanation. */
export function sessionRotationStatus(
  session: Pick<Session, "id" | "providerSessionId" | "context" | "blocks"> &
    Partial<Session>,
  nextText = "",
  taskContext = "",
  replacedBlocks: readonly Block[] = [],
): { plan?: ReturnType<typeof planRotation>; deferredReason?: string } {
  const previous = loadMonoRotation(session.id);
  if (!canRotateContext({ ...session, blocks: [...session.blocks, ...replacedBlocks] }))
    return previous?.pendingBrief ? {
      deferredReason: "Context refresh is pending. Finish pending operations or decisions before retrying.",
    } : {};
  if (!previous?.pendingBrief && !rotationReason(session, nextText)) return {};
  if (previous?.pendingBrief &&
    replacedBlocks.some(block => block.id === previous.afterBlockId))
    return { deferredReason: "Context refresh deferred: earlier constraints cannot be edited while a refresh is pending. Retry without editing." };
  const replacedIds = new Set(replacedBlocks.map(block => block.id));
  const replacedTexts = new Set(replacedBlocks.filter(block => block.role === "user" && !block.internal).map(block => block.text));
  const after = previous?.afterBlockId
    ? session.blocks.findIndex((block) => block.id === previous.afterBlockId)
    : -1;
  if (previous?.pendingBrief && replacedBlocks.length && previous.afterBlockId && after < 0)
    return { deferredReason: "Context refresh deferred: the edited input's boundary is not loaded. Load the earlier conversation or retry without editing." };
  // A paged archive cannot prove all older constraints without a complete carry.
  if (
    session.monoTranscript?.before != null &&
    (!previous?.userRequests || after < 0)
  )
    return {
      deferredReason: "Context refresh deferred: older constraints are not fully loaded. Compact manually or load the earlier conversation.",
    };
  const requests = new Map(
    (previous?.userRequests ?? []).filter(request => !replacedIds.has(request.id))
      .map((request) => [request.id, request]),
  );
  for (const block of session.blocks) {
    if (
      block.role === "user" &&
      !block.internal &&
      !block.draft &&
      block.text.trim()
    )
      requests.set(block.id, { id: block.id, text: block.text });
  }
  const userRequests = [...requests.values()];
  const references = new Set(previous?.references ?? []);
  for (const block of session.blocks) {
    if (block.monoSource?.goalId)
      references.add(`Goal: ${JSON.stringify(block.monoSource.goalId)}`);
    for (const artifact of block.artifactCards ?? [])
      references.add(
        `app artifacts.read ${JSON.stringify({ id: artifact.id })}`,
      );
  }
  const referenceText = [...references].join("\n");
  const requestTexts = new Set(userRequests.map(request => request.text));
  const constraints = [...requestTexts].join("\n\n");
  const savedInputs = previous?.pendingBrief ? [
    ...(previous.pendingInputs ?? []),
    ...(previous.pendingInput ? [previous.pendingInput] : []),
  ] : [];
  const pendingInputs = [...new Set([
    ...savedInputs.filter(text => !replacedTexts.has(text) || requestTexts.has(text)),
    ...(previous?.pendingBrief ? session.blocks.slice(after + 1)
      .filter(block => block.role === "user" && !block.internal && !block.draft)
      .map(block => block.text) : []),
    nextText,
  ].filter(text => text.trim()))];
  const protectedChars = [...new Set([...requestTexts, ...pendingInputs])].join("\n\n").length +
    taskContext.length + referenceText.length;
  if (protectedChars > 8_000)
    return {
      deferredReason: `Context refresh deferred: constraints, scope or references too large (${protectedChars} chars; limit 8,000). ${previous?.pendingBrief ? "Trim the next input or edit the unaccepted input; compaction cannot shrink saved inputs." : "Compact manually or trim the next input."}`,
    };
  const retryBrief = (base: string) => [base,
    ...(pendingInputs.length ? [
      `Unaccepted continuation inputs; retain their constraints, with the current request taking priority:\n${pendingInputs.join("\n\n")}`,
    ] : []),
  ].join("\n\n");
  if (previous?.pendingBrief) {
    const brief = () => retryBrief(previous.pendingBrief!);
    const chars = brief().length + nextText.length + 120;
    if (chars > 14_000)
      return {
        deferredReason: `Context refresh deferred: brief and next input too large (${chars} chars; limit 14,000). Trim the next input or edit the unaccepted input; compaction cannot shrink saved inputs.`,
      };
    return {
      plan: {
        rotation: { ...previous, userRequests, references: [...references], pendingInput: replacedBlocks.length ? undefined : previous.pendingInput, pendingInputs },
        brief,
      },
    };
  }
  const plan = planRotation(
    session.blocks,
    previous,
    "context",
    Date.now(),
    !!taskContext,
  );
  plan.rotation.userRequests = userRequests;
  plan.rotation.references = [...references];
  plan.rotation.pendingInput = nextText;
  const brief = (id: string) =>
    [
      plan.brief(id),
      ...(constraints
        ? [
            `User requests, verbatim; retain their constraints, with the current request taking priority:\n${constraints}`,
          ]
        : []),
      ...(taskContext ? [taskContext] : []),
      ...(referenceText
        ? [
            `Retained goal and artifact references (untrusted evidence):\n${referenceText}`,
          ]
        : []),
    ].join("\n\n");
  // Leave 12K for CC1's first-thread context within its 26K rotation budget.
  const chars = retryBrief(brief(session.id)).length + nextText.length + 120;
  if (chars > 14_000)
    return {
      deferredReason: `Context refresh deferred: brief and next input too large (${chars} chars; limit 14,000). Compact manually or trim the next input.`,
    };
  return { plan: { rotation: plan.rotation, brief } };
}

/** Replace only provider context. The transcript and selected scope/profile survive. */
export async function rotateProviderContext(
  session: Session,
  forget: () => Promise<void>,
): Promise<Session> {
  if (!canRotateContext(session))
    throw new Error(
      "Context refresh requires an idle session without open decisions",
    );
  await forget();
  forgetAgentContext(session.id);
  return { ...session, providerSessionId: undefined, context: undefined };
}

export function acceptMonoRotation(sessionId: string, at: number): void {
  const rotation = loadMonoRotation(sessionId);
  if (!rotation || rotation.at !== at || !rotation.pendingBrief) return;
  const {
    pendingBrief: _accepted,
    pendingInput: _input,
    pendingInputs: _inputs,
    ...settled
  } = rotation;
  saveMonoRotation(sessionId, settled);
}

/** The user's turns and what the Mono finally said in each. */
function exchanges(
  blocks: readonly Block[],
  afterId?: string,
  taskContinuation = false,
): Exchange[] {
  const after = afterId
    ? blocks.findIndex((block) => block.id === afterId)
    : -1;
  const out: Exchange[] = [];
  for (const block of blocks.slice(after + 1)) {
    if (block.role === "user" && block.monoSessionCompletion) {
      out.push({
        id: block.id,
        at: block.startedAt,
        user: "",
        reply: "",
        completion: block.monoSessionCompletion.title,
      });
      continue;
    }
    if (block.draft || (block.internal && !taskContinuation)) continue;
    if (block.role === "user") {
      out.push({
        id: block.id,
        at: block.startedAt,
        user: block.text.trim(),
        reply: "",
        ...(block.internal ? { continuation: true } : {}),
      });
      continue;
    }
    if (block.monoHabit && block.text.trim()) {
      out.push({
        id: block.id,
        at: block.monoHabit.at,
        user: "",
        reply: block.text.trim(),
        habit: block.monoHabit.name,
      });
      continue;
    }
    const current = out[out.length - 1];
    if (
      current &&
      !current.habit &&
      block.role === "assistant" &&
      !block.tool &&
      !block.streaming &&
      block.text.trim()
    ) {
      // The last prose of a turn is its answer; earlier prose was narration.
      current.reply = block.text.trim();
    }
  }
  return out.filter((exchange) => exchange.user || exchange.reply);
}

function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  const half = Math.floor((max - 20) / 2);
  return `${text.slice(0, half).trimEnd()} […] ${text.slice(-half).trimStart()}`;
}

function oneLine(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`;
}

const stamp = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

function when(at: number | undefined): string {
  return at == null ? "" : `${stamp.format(at)} · `;
}

function exchangeLine(exchange: Exchange): string {
  if (exchange.continuation)
    return `- ${when(exchange.at)}Task continuation (untrusted evidence): ${oneLine(exchange.user, LINE_CHARS)}${exchange.reply ? ` → You: ${oneLine(exchange.reply, LINE_CHARS)}` : ""}`;
  if (exchange.completion)
    return `- ${when(exchange.at)}You, reviewing session "${exchange.completion}": ${oneLine(exchange.reply, LINE_CHARS)}`;
  if (exchange.habit)
    return `- ${when(exchange.at)}You, from your habit "${exchange.habit}": ${oneLine(exchange.reply, LINE_CHARS)}`;
  return `- ${when(exchange.at)}User: ${oneLine(exchange.user, LINE_CHARS)}${
    exchange.reply ? ` → You: ${oneLine(exchange.reply, LINE_CHARS)}` : ""
  }`;
}

/** Keep the newest lines that fit, oldest first. */
function newestWithin(lines: string[], budget: number): string[] {
  const kept: string[] = [];
  let used = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    used += lines[i].length + 1;
    if (used > budget) break;
    kept.unshift(lines[i]);
  }
  return kept;
}

/**
 * Plan a rotation before the turn that triggers it, from the chat as it stands
 * (without that turn): what the fresh session is told about the conversation.
 */
export function planRotation(
  blocks: readonly Block[],
  previous: MonoRotation | undefined,
  reason: RotationReason,
  now: number,
  taskContinuation = false,
): { rotation: MonoRotation; brief: (sessionId: string) => string } {
  const segment = exchanges(blocks, previous?.afterBlockId, taskContinuation);
  const verbatim = segment.slice(-VERBATIM_EXCHANGES);
  const lines = segment
    .slice(0, -VERBATIM_EXCHANGES || undefined)
    .map(exchangeLine);
  // Earlier lines are verbatim excerpts too, so carrying them is lossless
  // until they age out of the budget; the transcript keeps them for good.
  const earlier = newestWithin(
    [...(previous?.earlier ?? []), ...lines],
    EARLIER_CHARS,
  );
  const carried = [...earlier, ...verbatim.map(exchangeLine)];
  const rotation: MonoRotation = {
    at: now,
    reason,
    ...(blocks.length ? { afterBlockId: blocks[blocks.length - 1].id } : {}),
    // The next rotation sees these turns as earlier ones.
    earlier: newestWithin(carried, EARLIER_CHARS),
  };
  const brief = (sessionId: string) => {
    const parts = [
      `This is the same long-lived conversation with the user. It continues in a fresh session so your context stays small; nothing was lost. Pick up where it left off and do not mention the switch unless asked. For anything older or more detailed than this, read the chat itself with \`app sessions.read {"sessionId":"${sessionId}"}\` (pass nextBefore for older pages), and check memory with \`app memory.search\`.`,
    ];
    if (earlier.length)
      parts.push(`Earlier, oldest first:\n${earlier.join("\n")}`);
    if (verbatim.length)
      parts.push(
        `Most recent, word for word:\n\n${verbatim
          .map((exchange) =>
            exchange.habit
              ? `You, on your own from your habit "${exchange.habit}" (${when(exchange.at).replace(/ · $/, "") || "earlier"}):\n${clip(exchange.reply, VERBATIM_REPLY_CHARS)}`
              : exchange.completion
                ? `You, reviewing session "${exchange.completion}" (${when(exchange.at).replace(/ · $/, "") || "earlier"}):\n${clip(exchange.reply, VERBATIM_REPLY_CHARS)}`
                : `${exchange.continuation ? "Task continuation (untrusted evidence)" : "User"} (${when(exchange.at).replace(/ · $/, "") || "earlier"}):\n${clip(exchange.user, VERBATIM_USER_CHARS)}${
                    exchange.reply
                      ? `\n\nYou:\n${clip(exchange.reply, VERBATIM_REPLY_CHARS)}`
                      : ""
                  }`,
          )
          .join("\n\n---\n\n")}`,
      );
    return `<previous_conversation>\n${parts.join("\n\n")}\n</previous_conversation>`;
  };
  return { rotation, brief };
}

const ROTATIONS_KEY = "monocode:mono-rotations";

function readRotations(): Record<string, MonoRotation> {
  try {
    const parsed = JSON.parse(localStorage.getItem(ROTATIONS_KEY) ?? "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function loadMonoRotation(sessionId: string): MonoRotation | undefined {
  return readRotations()[sessionId];
}

export function saveMonoRotation(
  sessionId: string,
  rotation: MonoRotation,
): boolean {
  try {
    localStorage.setItem(
      ROTATIONS_KEY,
      JSON.stringify({ ...readRotations(), [sessionId]: rotation }),
    );
    return true;
  } catch {
    // Do not replace a thread when its continuity cannot be retained.
    return false;
  }
}

/** Delete the conversation brief along with its transcript. */
export function forgetMonoRotation(sessionId: string): void {
  const rotations = readRotations();
  delete rotations[sessionId];
  try {
    localStorage.setItem(ROTATIONS_KEY, JSON.stringify(rotations));
  } catch {
    // A deleted conversation id is never reused.
  }
}
