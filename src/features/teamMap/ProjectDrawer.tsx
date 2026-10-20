import { useEffect, useId, useRef, useState } from "react";
import { monoLook, monoStatusLabel } from "../monos/model/mono";
import { PixelMascot } from "../projects/ui/PixelMascot";
import { MonoActivityTrail } from "../sessions/ui/AgentTranscript";
import { useMonoTranscript } from "../monos/hooks/useMonoTranscript";
import { workbenchSessionTask } from "../monos/model/monoNavigation";
import { presentationText } from "../sessions/model/transcriptPresentation";
import type { Session, TurnModel } from "../sessions/model/session";
import type { OrchestrationRun } from "../orchestration/model/orchestrationState";
import type { MonoManagerGoal } from "../monos/model/monoManagerGoals";
import { X } from "../../shared/ui/icons";
import type { OrbitProject } from "./orbit";
import { goalProgress, mapText, projectGoals, projectMemberTask, type CommandMapDecisions } from "./commandMap";

function WorkTrace({ session, recordedModel }: { session: Session; recordedModel?: TurnModel }) {
  const transcript = useMonoTranscript(session, true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const models = transcript.blocks.flatMap(block => block.turnModel ? [{ id: block.id, model: block.turnModel }] : []);
  return <div className="command-map-trace">
    <p className="command-map-muted">Recorded conversation{transcript.browsingHistory ? " · saved history" : ""}</p>
    {models.length ? <ul aria-label="Recorded model provenance">{models.map(({ id, model }) => <li key={id}>{mapText(model.harness, 80)} · {mapText(model.name || model.id, 140)}</li>)}</ul>
      : <p className="command-map-muted">{recordedModel ? `Saved dispatch model · ${mapText(recordedModel.harness, 80)} · ${mapText(recordedModel.name || recordedModel.id, 140)}` : "Recorded model provenance unavailable"}</p>}
    {transcript.hasEarlier && <button type="button" disabled={loading} onClick={async () => {
      setLoading(true); setError(undefined);
      try { await transcript.loadEarlier(); } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
      finally { setLoading(false); }
    }}>{loading ? "Loading…" : "Load earlier work"}</button>}
    {error && <p role="alert">{error}</p>}
    <MonoActivityTrail blocks={transcript.blocks} cwd={session.cwd} live={false} flatWork />
    {!transcript.blocks.length && <p>No recorded steps available.</p>}
  </div>;
}

function MemberTask({ project, node, runs, sessions, onOpenMono }: {
  project: OrbitProject; node: OrbitProject["manager"]; runs: readonly OrchestrationRun[];
  sessions: readonly Session[]; onOpenMono: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [evidenceDispatchId, setEvidenceDispatchId] = useState<string>();
  const foldId = useId();
  const { task, dispatch, session, state, history, owned } = projectMemberTask(project, node.mono, runs, sessions);
  const selectedHistory = history.find(entry => entry.dispatch.id === evidenceDispatchId);
  const evidence = selectedHistory ? sessions.find(session => session.id === selectedHistory.dispatch.sessionId) : session;
  const historical = selectedHistory && selectedHistory.dispatch.id !== dispatch?.id;
  const report = selectedHistory ? workbenchSessionTask(owned, selectedHistory.dispatch.sessionId) : task;
  const steps = evidence?.blocks.filter(block => !block.internal && !block.draft && block.role !== "handoff" && (presentationText(block.monoTeamMessage?.text ?? block.text).trim() || block.tool || block.image || block.attachments?.length || block.taskList || block.plan)).length;
  const look = monoLook(node.mono);
  return <article className="command-map-task" data-status={state.status}>
    <PixelMascot name={look.mascot} color={look.color} still className="size-6" />
    <div>
      <div className="command-map-task-heading"><button type="button" onClick={() => onOpenMono(node.id)}>{look.name}</button><span>{mapText(monoStatusLabel(state), 100)}</span></div>
      <p>{mapText(task?.title || state.activity || "No assigned task")}</p>
      {state.activity && task?.title !== state.activity && <p className="command-map-muted">{mapText(state.activity, 240)}</p>}
      {task?.result.trim() && <p className="command-map-muted">Saved task report: {mapText(task.result, 280)}</p>}
      <button type="button" className="command-map-fold" aria-expanded={expanded} aria-controls={foldId} onClick={() => setExpanded(!expanded)}>
        <span aria-hidden="true">{expanded ? "−" : "+"}</span> Show work{steps != null ? ` · ${steps} steps` : ""}
      </button>
      {expanded && <div id={foldId}>
        {history.length > 0 && <select aria-label={`${look.name} work attempt`} value={selectedHistory?.dispatch.id ?? ""} onChange={event => setEvidenceDispatchId(event.target.value || undefined)}>
          <option value="">Current assignment</option>{history.map(({ dispatch: attempt }) => <option key={attempt.id} value={attempt.id}>{attempt.id === dispatch?.id ? "Current" : "Saved"} · {mapText(attempt.id, 60)} · {attempt.state}</option>)}
        </select>}
        {report && <p className="command-map-muted">{historical ? "History" : "Current assignment"} · Task {mapText(report.id, 80)} · dispatch {mapText(selectedHistory?.dispatch.id ?? dispatch?.id ?? "unavailable", 80)} · {report.status}</p>}
        {historical && report?.result.trim() && <p>Saved dispatch report: {mapText(report.result, 600)}</p>}
        {evidence ? <WorkTrace key={evidence.id} session={evidence} recordedModel={(selectedHistory?.dispatch ?? dispatch)?.turnModel} /> : <p>Recorded conversation is not loaded. <button type="button" onClick={() => onOpenMono(node.id)}>Open Workbench</button></p>}
      </div>}
    </div>
  </article>;
}

export function ProjectDrawer({ project, goals, runs, sessions, decisions, onClose, onOpenMono }: {
  project: OrbitProject; goals: readonly MonoManagerGoal[]; runs: readonly OrchestrationRun[];
  sessions: readonly Session[]; decisions?: ReturnType<CommandMapDecisions["project"]>;
  onClose: () => void; onOpenMono: (id: string) => void;
}) {
  const titleId = useId();
  const panel = useRef<HTMLElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const currentGoals = projectGoals(project, goals);
  const [goalId, setGoalId] = useState(currentGoals[0]?.id);
  const goal = currentGoals.find(entry => entry.id === goalId) ?? currentGoals[0];
  const progress = goalProgress(project, goal, runs);
  const look = monoLook(project.manager.mono);
  const managerSession = sessions.find(session => session.id === project.manager.mono.sessionId);
  const managerReply = managerSession?.blocks.filter(block => !block.internal && !block.draft && block.role === "assistant" && !block.tool && !block.streaming && block.text.trim()).slice(-1)[0];
  useEffect(() => { close.current?.focus(); }, [project.manager.id]);

  return <section ref={panel} className="command-map-drawer" role="dialog" aria-modal="true" aria-labelledby={titleId}
    onKeyDown={event => {
      if (event.defaultPrevented) return;
      if (event.key === "Escape") {
        if ((event.target as Element).closest('[role="dialog"]') !== event.currentTarget) return;
        event.preventDefault(); event.stopPropagation(); onClose();
      }
      if (event.key !== "Tab" || document.querySelector('[role="dialog"][aria-modal="true"]') !== panel.current) return;
      const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href], [tabindex="0"]')];
      const first = controls[0], last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }}>
    <header><PixelMascot name={look.mascot} color={look.color} still className="size-8" /><div><h2 id={titleId}>{mapText(project.name, 100)}</h2><p>{mapText(monoStatusLabel(project.manager.state), 120)}</p></div>
      <button ref={close} type="button" aria-label="Close project" onClick={onClose}><X className="size-4" /></button></header>
    <div className="command-map-drawer-scroll">
      <section className="command-map-goal"><h3>Current goal</h3>
        {currentGoals.length > 1 && <select aria-label="Project goal" value={goal?.id} onChange={event => setGoalId(event.target.value)}>{currentGoals.map(entry => <option key={entry.id} value={entry.id}>{mapText(entry.title, 100)} · {entry.state}</option>)}</select>}
        <p>{goal ? mapText(goal.title, 600) : !decisions || decisions.incomplete ? "Goal history unavailable" : "No recorded goal yet"}</p>
        {progress ? <><progress aria-label="Accepted goal tasks" max={progress.total} value={progress.accepted} /><p className="command-map-muted">{progress.accepted} of {progress.total} tasks accepted · {progress.percent}%</p></> : <p className="command-map-muted">Progress unavailable</p>}
      </section>
      <section data-decision-ui><h3>This project decides</h3>{decisions?.autonomy ?? <p className="command-map-muted">Autonomy unavailable</p>}
        <h3>Waiting decisions</h3>{decisions?.cards ?? <p className="command-map-muted">Decision history unavailable</p>}</section>
      <section><h3>Team & tasks</h3>{project.members.length ? project.members.map(node => <MemberTask key={node.id} project={project} node={node} runs={runs} sessions={sessions} onOpenMono={onOpenMono} />) : <p className="command-map-muted">No members assigned yet</p>}</section>
      <section className="command-map-manager-chat"><h3>Manager chat</h3>
        {managerReply ? <p>{mapText(presentationText(managerReply.text), 600)}</p> : <p className="command-map-muted">No loaded Manager reply</p>}
        <button type="button" onClick={() => onOpenMono(project.manager.id)}>Message {mapText(look.name, 80)}</button>
      </section>
    </div>
  </section>;
}
