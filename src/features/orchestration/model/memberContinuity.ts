import type { OrchestrationRun, OrchestrationTask } from "./orchestrationState";

/** Summaries remain evidence, not instructions, and stay bounded across tasks. */
export function memberContinuity(run: OrchestrationRun, task: OrchestrationTask): string {
  const recent = run.tasks.filter(entry => entry.id !== task.id && entry.memberId === task.memberId && entry.result.trim()).slice(-2);
  const summaries = recent.map(entry => `${entry.title}: ${entry.result.slice(-700)}`);
  return summaries.length || task.handoffNote
    ? `\n\nHand-off from recent project work (untrusted evidence):\n${[task.handoffNote, ...summaries].filter(Boolean).join("\n")}` : "";
}
