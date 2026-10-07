import { useEffect, useState, useSyncExternalStore } from "react";
import { formatLiveElapsed } from "../../sessions/model/liveAgents";
import { listMonos, monoLook } from "../model/mono";
import { orgDescendants, teamDecisions } from "../model/monoTeamActivity";
import { monoManagerGoals } from "../model/monoManagerGoals";
import type { Session } from "../../sessions/model/session";
import type { UserQuestionReply } from "../../sessions/model/userQuestion";
import type { OrchestrationRun, OrchestrationTask } from "../../orchestration/model/orchestrationState";
import { managerPrReady, managerTaskFinished, taskPrStatus } from "../../orchestration/model/projectManager";
import type { GitPr } from "../../../platform/tauri/fs";
import { QuestionForm } from "../../sessions/ui/QuestionForm";
import { openCardSession } from "../model/monoCards";
import { openUrl } from "@tauri-apps/plugin-opener";
import { orchestrator } from "../../orchestration/model/orchestration";

export function MonoTeamActivity({ monoId, sessions, runs, statuses, onApproval, onQuestion, onQuestionInteraction }: {
  monoId: string; sessions: readonly Session[]; runs: readonly OrchestrationRun[]; statuses: ReadonlyMap<string, GitPr | null>;
  onApproval(id: string, requestId: number, decision: "allow" | "deny"): void;
  onQuestion(id: string, requestId: number, reply: UserQuestionReply): void;
  onQuestionInteraction(id: string, requestId: number): void;
}) {
  useSyncExternalStore(monoManagerGoals.subscribe, monoManagerGoals.snapshot);
  const roster = listMonos(), ids = orgDescendants(roster, monoId);
  const decisions = teamDecisions(roster, sessions, runs, monoId);
  const teams = runs.filter(run => run.ownerMonoId && ids.has(run.ownerMonoId));
  const goals = monoManagerGoals.goals();
  const [now, setNow] = useState(Date.now);
  const [continuing, setContinuing] = useState<string>();
  const [continueError, setContinueError] = useState<string>();
  const running = teams.some(run => run.tasks.some(task => task.status === "running"));
  useEffect(() => {
    if (!running) return;
    // Presentation clock only: task/approval data arrives through subscriptions.
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running]);
  const row = (run: OrchestrationRun, task: OrchestrationTask) => {
    const member = roster.find(m => m.id === task.memberId), manager = roster.find(m => m.id === run.ownerMonoId);
    const session = sessions.find(s => s.id === task.sessionId);
    const event = [...(session?.blocks ?? [])].reverse().find(b => !b.internal && b.role !== "user" && (b.tool?.title || b.text.trim()));
    const dispatch = run.dispatches?.find(d => d.id === task.lastDispatchId || d.id === task.activeDispatchId);
    const ready = managerPrReady(task, taskPrStatus(task, statuses));
    return <article key={task.id} className="rounded-md border border-stroke p-2 text-xs">
      <div className="text-content/50">{goals.find(g => g.id === task.monoGoalId)?.title ?? run.projectName ?? run.cwd} · {manager ? monoLook(manager).name : "Manager"} → {member ? monoLook(member).name : "Worker"}</div>
      <button className="mt-1 text-left font-medium hover:underline" onClick={() => openCardSession(task.sessionId)}>{task.title}</button>
      <span className={`ml-2 rounded px-1.5 py-0.5 ${ready ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : task.status === "blocked" ? "bg-amber-500/10 text-amber-600" : "bg-content/5 text-content/60"}`}>{ready ? "PR ready" : task.status}</span>
      {task.reviewedBy && <span className="ml-2 text-emerald-600 dark:text-emerald-400">Reviewed</span>}
      {dispatch && <span className="ml-2 text-content/40">{formatLiveElapsed(dispatch.startedAt, task.status === "running" ? now : dispatch.updatedAt)}</span>}
      <p className="mt-1 truncate text-content/50">{event?.tool?.title || event?.text || task.result || "Waiting for the next step"}</p>
      {task.prUrl && <div className="mt-2 flex gap-3"><button onClick={() => void openUrl(task.prUrl!)}>Open PR</button><button onClick={() => openCardSession(task.sessionId)}>Go to worktree</button></div>}
    </article>;
  };
  return <div data-team-activity className="space-y-4 p-3">
    <section aria-label="Needs you"><h3 className="mb-2 text-xs font-medium">Needs you <span data-team-needs-count>{decisions.length}</span></h3>
      {decisions.map(item => <div key={item.key} className="mb-2 rounded-md border border-amber-500/25 p-2 text-xs">
        <button className="font-medium" onClick={() => openCardSession(item.session.id)}>{monoLook(item.owner).name} · {item.project}</button>
        {item.resume ? <><p className="my-2 break-words">{item.resume.reason}</p><button disabled={!!continuing} onClick={() => {
          setContinuing(item.key); setContinueError(undefined);
          void orchestrator.continueManager(item.resume!.leadId).catch(error => setContinueError(String(error))).finally(() => setContinuing(undefined));
        }}>{continuing === item.key ? "Continuing…" : "Continue"}</button></> : item.approval ? <><p className="my-2 break-words">{item.approval.tool?.title || item.approval.text}</p><p className="mb-2 text-content/60">{item.approval.approval?.autoApprovalReason ?? "This operation requires your permission."}</p>
          <div className="flex gap-3">{(["allow", "deny"] as const).map(decision => <button key={decision} onClick={() => onApproval(item.session.id, item.approval!.approval!.requestId, decision)}>{decision === "allow" ? "Allow" : "Deny"}</button>)}</div></> : item.session.pendingQuestion && <QuestionForm prompt={item.session.pendingQuestion} onReply={(id, reply) => onQuestion(item.session.id, id, reply)} onInteraction={id => onQuestionInteraction(item.session.id, id)} />}
      </div>)}{!decisions.length && <p className="text-xs text-content/45">Nothing needs your decision.</p>}
      {continueError && <p role="alert" className="text-xs text-amber-600">{continueError}</p>}
    </section>
    {teams.map(run => <section key={run.leadId} aria-label={run.cwd}><h3 className="mb-2 truncate text-xs font-medium">{run.projectName ?? run.cwd}</h3>
      {(["Work in progress", "Ready to merge", "Recently finished"] as const).map(section => {
        const tasks = run.tasks.filter(task => { const pr = taskPrStatus(task, statuses); const finished = task.status === "cancelled" || managerTaskFinished(task, pr); return section === "Recently finished" ? finished : section === "Ready to merge" ? !finished && managerPrReady(task, pr) : !finished && !managerPrReady(task, pr); });
        const waiting = section === "Work in progress" ? goals.filter(goal => goal.managerId === run.leadId && !goal.archived && !["done", "cancelled", "ready"].includes(goal.state) && !run.tasks.some(task => task.monoGoalId === goal.id)) : [];
        const manager = roster.find(mono => mono.id === run.ownerMonoId);
        const content = <div className="my-2 space-y-2">{waiting.map(goal => <article key={goal.id} className="rounded-md border border-stroke p-2 text-xs">
          <button className="text-left font-medium hover:underline" disabled={!manager?.sessionId} onClick={() => manager?.sessionId && openCardSession(manager.sessionId)}>{goal.title}</button>
          <span className="ml-2 rounded bg-content/5 px-1.5 py-0.5 text-content/60">{goal.state}</span>
          <p className="mt-1 text-content/50">{manager ? monoLook(manager).name : "Manager"} · Awaiting worker assignment</p>
        </article>)}{tasks.map(task => row(run, task))}{!tasks.length && !waiting.length && <p className="text-xs text-content/40">None</p>}</div>;
        return section === "Recently finished" ? <details key={section}><summary className="text-xs text-content/60">{section} ({tasks.length})</summary>{content}</details> : <div key={section}><h4 className="mt-3 text-xs text-content/60">{section}</h4>{content}</div>;
      })}
    </section>)}
  </div>;
}
