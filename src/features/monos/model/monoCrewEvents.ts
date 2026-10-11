export type CrewMessageKind = "info" | "question" | "decision" | "escalation";
export type CrewMessage = { id: string; managerId: string; senderId: string; recipientId: string; topic: string; text: string; at: number; summary?: string; requiresReply?: boolean; kind?: CrewMessageKind };
const key = "monocode:crew-messages";
const listeners = new Set<() => void>();
export function crewMessages(): CrewMessage[] {
  try { return JSON.parse(localStorage.getItem(key) ?? "[]"); } catch { return []; }
}
export function recordCrewMessage(event: CrewMessage): void {
  const events = crewMessages();
  if (events.some(entry => entry.id === event.id)) return;
  localStorage.setItem(key, JSON.stringify([...events, event].slice(-500)));
  listeners.forEach(listener => listener());
}
export function teamMessageKind(value: unknown): CrewMessageKind | undefined {
  if (value === undefined || value === "info" || value === "question" || value === "decision" || value === "escalation") return value;
  throw Error("kind must be info, question, decision or escalation");
}
export function teamMessageRequiresReply(value: unknown, kind?: unknown): boolean {
  if (value !== undefined && typeof value !== "boolean") throw Error("requiresReply must be a boolean");
  const messageKind = teamMessageKind(kind);
  return value !== false && messageKind !== "info";
}
/** Informational messages reach the feed without waking a recipient or steering its work. */
export async function deliverCrewMessage(event: CrewMessage, deliver: () => Promise<void>): Promise<void> {
  if (teamMessageRequiresReply(event.requiresReply, event.kind)) await deliver();
  recordCrewMessage(event);
}
export function subscribeCrewMessages(listener: () => void): () => void {
  listeners.add(listener); return () => { listeners.delete(listener); };
}
export function crewMessagesSnapshot(): string { return localStorage.getItem(key) ?? "[]"; }

export function recordCrewDecision(runs: readonly OrchestrationRun[], sessionId: string, eventId: string, summary: string): void {
  const roster = listMonos();
  const run = runs.find(run => run.tasks.some(task => task.sessionId === sessionId) || run.ownerSessionId === sessionId);
  const member = roster.find(mono => mono.sessionId === sessionId || mono.id === run?.tasks.find(task => task.sessionId === sessionId)?.memberId);
  const managerId = run?.ownerMonoId ?? (member?.role === "manager" ? member.id : member?.reportsTo);
  if (!managerId) return;
  recordCrewMessage({ id: eventId, managerId, senderId: "user", recipientId: member?.id ?? managerId, topic: "Decision", text: summary, summary: `You ${summary} · ${member ? monoLook(member).name : "team"}`, at: Date.now() });
}
import type { OrchestrationRun } from "../../orchestration/model/orchestrationState";
import { listMonos, monoLook } from "./mono";
