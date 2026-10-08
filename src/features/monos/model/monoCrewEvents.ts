export type CrewMessage = { id: string; managerId: string; senderId: string; recipientId: string; topic: string; text: string; at: number; summary?: string };
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
