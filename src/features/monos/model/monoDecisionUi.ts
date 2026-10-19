import { assertDecisionUiGesture, type MonoDecision } from "./monoDecisions";
import type { SubmissionAcceptance } from "../../../app/model/submissionAcceptance";

const quoted = (value: string) => value.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, " ")
  .replace(/[`*_#\[\]<>~\\]/g, "").replace(/"/g, "'").replace(/\s+/g, " ").trim().slice(0, 120);
export function decisionUserText(row: MonoDecision, optionId?: string, askerName = "the asker"): string {
  if (optionId === undefined) return `Please decide for "${quoted(askerName)}" on the asker's question "${quoted(row.question)}": ${row.options.map(option => `"${quoted(option.label)}"`).join(" or ")}.`;
  const option = row.options.find(option => option.id === optionId);
  if (!option) throw Error("Choose one of the options");
  return `Decision on your question "${quoted(row.question)}": go with "${quoted(option.label)}".`;
}

export type DecisionSendHost = {
  read(): MonoDecision | undefined;
  open(sessionId: string): Promise<boolean>;
  bossSession(bossId: string): Promise<string | undefined>;
  askerName(id: string): string;
  submit(sessionId: string, text: string, attachments: []): SubmissionAcceptance;
  record(optionId?: string): Promise<void>;
  pending: Set<string>;
  accepted: Set<string>;
};

/** Acceptance is the existing user queue's result, never execution permission. */
export async function sendDecisionFromClick(event: Event, key: string, optionId: string | undefined, host: DecisionSendHost): Promise<{ logFailed: boolean }> {
  assertDecisionUiGesture(event);
  if (host.pending.has(key) || host.accepted.has(key)) throw Error("This answer is already being sent");
  const row = host.read();
  if (!row || row.readOnly || row.status !== "waiting" || row.noLongerNeededAt != null || row.answererId !== "user") throw Error("This ask no longer needs your answer");
  if (optionId === undefined && row.operation !== "work") throw Error("This ask needs your answer");
  const text = decisionUserText(row, optionId, host.askerName(row.requestingMonoId));
  host.pending.add(key);
  try {
    const boss = row.escalationChain.find(entry => entry.level === "boss");
    const sessionId = optionId === undefined ? boss && await host.bossSession(boss.id) : row.requesterSessionId;
    if (!sessionId || !await host.open(sessionId) || !await host.submit(sessionId, text, [])) throw Error("Recipient could not accept the message");
    host.accepted.add(key);
    try { await host.record(optionId); return { logFailed: false }; }
    catch { return { logFailed: true }; } // The accepted message must never be offered as an unsent retry.
  } finally { host.pending.delete(key); }
}
