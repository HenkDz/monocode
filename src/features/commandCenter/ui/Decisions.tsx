import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import type { Mono } from "../../monos/model/mono";
import type { MonoDecision, ProjectAutonomy } from "../../monos/model/monoDecisions";
import { projectName } from "../../../shared/lib/paths";
import { decisionActorName, type DecisionView, type OwnedDecision } from "../model/decisionView";
import "./decisions.css";
export const DECISIONS_SCOPE = "command-center:decisions";

export type DecisionUiActions = {
  answer(event: Event, managerId: string, decisionId: string, optionId?: string): Promise<{ logFailed: boolean }>;
  autonomy(event: Event, managerId: string, projectId: string, value: ProjectAutonomy): Promise<void>;
  openProject(projectId: string): void;
  wasAccepted?(managerId: string, decisionId: string): boolean;
  context?(decision: MonoDecision): string;
  installCard?(item: OwnedDecision): ReactNode;
};
export function DecisionCard({ item, roster, actions, sentInitially = false, sentToBoss = false }: { item: OwnedDecision; roster: readonly Mono[]; actions: DecisionUiActions; sentInitially?: boolean; sentToBoss?: boolean }) {
  const { decision, managerId } = item;
  const titleId = useId();
  const pending = useRef(false);
  const target = decisionActorName(roster, decision.requestingMonoId);
  const acceptedInitially = sentInitially || !!actions.wasAccepted?.(managerId, decision.id);
  const [busy, setBusy] = useState(false), [sent, setSent] = useState(acceptedInitially), [notice, setNotice] = useState(sentInitially ? `Sent to ${sentToBoss ? "Boss" : target}` : acceptedInitially ? "Answer sent" : "");
  const choose = (event: Event, optionId?: string) => {
    if (pending.current || sent) return;
    pending.current = true; setBusy(true); setNotice("");
    void actions.answer(event, managerId, decision.id, optionId).then(result => {
      setSent(true); setNotice(`Sent to ${optionId === undefined ? "Boss" : target}${result.logFailed ? ". Couldn't update the log." : ""}`);
    }, error => setNotice(error instanceof Error && /already being sent|no longer needs/.test(error.message) ? "Answer already sent or no longer needed" : `Couldn't reach ${optionId === undefined ? "Boss" : target} — try again`))
      .finally(() => { pending.current = false; setBusy(false); });
  };
  return <article className="decision-card" aria-labelledby={titleId} data-decision-ui data-sent={sent || undefined}>
    <ol className="decision-chain" aria-label="Escalation chain">{decision.escalationChain.map(entry => <li key={entry.id} data-level={entry.level}>{decisionActorName(roster, entry.id)}</li>)}</ol>
    <h2 id={titleId}>{decision.question}</h2>
    <p className="decision-meta"><span className="decision-impact" data-impact={decision.impact}>{decision.impact === "med" ? "Medium" : decision.impact === "high" ? "High" : "Low"} impact</span><span>{projectName(decision.projectId)}</span></p>
    <p className="decision-context">{actions.context?.(decision) ?? decision.context}</p>
    {actions.installCard?.(item)}
    <div className="decision-options" aria-label="Decision options">{decision.options.map(option => <button type="button" key={option.id} disabled={busy || sent} data-recommended={option.id === decision.recommendedOptionId}
      onClick={event => choose(event.nativeEvent, option.id)}><span>{option.label}</span>{option.id === decision.recommendedOptionId && <small>Recommended</small>}</button>)}</div>
    <footer><button type="button" onClick={() => actions.openProject(decision.projectId)}>Open project <span aria-hidden="true">→</span></button>
      {decision.operation === "work" && decision.escalationChain.some(entry => entry.level === "boss") && <button type="button" disabled={busy || sent} onClick={event => choose(event.nativeEvent)}>Let the Boss decide</button>}</footer>
    {notice && <p className="decision-note" role={sent ? "status" : "alert"}>{notice}</p>}
  </article>;
}
export function Decisions({ view, roster, actions, presentation = "page", error, attention, attentionCount = 0, goalActions, goalActionCount = 0 }: { view: DecisionView; roster: readonly Mono[]; actions: DecisionUiActions; presentation?: "page" | "rail"; error?: string; attention?: ReactNode; attentionCount?: number; goalActions?: ReactNode; goalActionCount?: number }) {
  const [tab, setTab] = useState<"pending" | "log">("pending");
  const key = (item: OwnedDecision) => JSON.stringify([item.managerId, item.decision.id]);
  type Row = OwnedDecision & { sentToBoss?: boolean };
  const [shown, setShown] = useState<{ pending: typeof view.pending; rows: Row[] }>({ pending: view.pending, rows: view.pending });
  // Keep accepted rows in place before DOM commit, so a second native click cannot hit the next ask.
  if (shown.pending !== view.pending) {
    const pending = new Map(view.pending.map(item => [key(item), item]));
    const rows = shown.rows.flatMap((item): Row[] => {
      const current = pending.get(key(item));
      pending.delete(key(item));
      if (current) return [current];
      return actions.wasAccepted?.(item.managerId, item.decision.id)
        ? [{ ...item, sentToBoss: item.sentToBoss ?? !view.log.some(row => key(row) === key(item) && row.decision.answeredBy === "user") }] : [];
    });
    setShown({ pending: view.pending, rows: rows.some(item => item.sentToBoss !== undefined) ? [...rows, ...pending.values()] : view.pending });
  }
  const leaving = JSON.stringify(shown.rows.filter(item => item.sentToBoss !== undefined).map(key));
  useEffect(() => {
    if (leaving === "[]") return;
    const timer = setTimeout(() => setShown(current => ({ ...current, rows: current.rows.filter(item => item.sentToBoss === undefined) })), 1300);
    return () => clearTimeout(timer);
  }, [leaving]);
  return <section className="decisions" data-presentation={presentation} data-decision-ui aria-label="Decisions">
    <header className="decisions-heading"><div><span className="decisions-eyebrow">Your calls</span><h1>Decisions</h1></div><span>{view.pending.length + attentionCount + goalActionCount ? `${view.pending.length + attentionCount + goalActionCount} need you` : "All clear"}</span></header>
    <div className="decisions-tabs" role="group" aria-label="Decision view"><button type="button" aria-pressed={tab === "pending"} onClick={() => setTab("pending")}>Needs you {!!(view.pending.length + attentionCount + goalActionCount) && <span>{view.pending.length + attentionCount + goalActionCount}</span>}</button><button type="button" aria-pressed={tab === "log"} onClick={() => setTab("log")}>Decision log</button></div>
    <div className="decisions-scroll">
      {error && <p role="alert" className="decision-note">{error}</p>}
      {tab === "pending" ? <>{shown.rows.map(item => <DecisionCard key={key(item)} item={item} roster={roster} actions={actions} sentInitially={item.sentToBoss !== undefined} sentToBoss={item.sentToBoss} />)}
        {goalActions}
        {!view.pending.length && !attentionCount && !goalActionCount && <div className="decision-empty"><h2>Nothing needs your decision</h2><p>The team keeps working toward the goals.</p></div>}
        {attention}
        {!!view.teamPending && <p className="decision-note">{view.teamPending} with Managers &amp; the Boss</p>}</>
        : <>{!view.log.length && <p className="decision-empty">No decisions yet</p>}<ol className="decision-log">{view.log.map(({ managerId, decision }) => <li key={`${managerId}:${decision.id}`} className="decision-log-item"><span className="decision-log-dot" aria-hidden="true" /><div><p>{decision.question}</p><strong>{decision.noLongerNeededAt != null ? "No longer needed" : decision.answer ?? "Earlier ask"}</strong><small>{decision.answeredBy ? decisionActorName(roster, decision.answeredBy) : "No answer recorded"}</small></div><time dateTime={new Date(decision.answeredAt ?? decision.createdAt).toISOString()}>{new Date(decision.answeredAt ?? decision.createdAt).toLocaleString()}</time></li>)}</ol></>}
      <footer className="decisions-handled"><span aria-hidden="true">✓</span><p>{view.handledToday} decided by the team today</p><button type="button" onClick={() => setTab("log")}>View log</button></footer>
      {!!view.pruned && <p className="decision-note">{view.pruned} older entries pruned</p>}{!!view.skipped && <p className="decision-note">{view.skipped} unreadable entries skipped</p>}
    </div>
  </section>;
}
export function ProjectAutonomyControl({ managerId, projectId, value, actions }: { managerId: string; projectId: string; value: ProjectAutonomy; actions: DecisionUiActions }) {
  const pending = useRef(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  return <div className="decision-autonomy" data-decision-ui><span>Ask me for</span><div role="group" aria-label="Project decision autonomy">{([["high-impact-only", "High-impact only"], ["medium-and-up", "Medium & up"], ["everything", "Everything"]] as const).map(([policy, label]) =>
    <button type="button" key={policy} aria-pressed={value === policy} disabled={busy} onClick={event => {
      if (pending.current) return;
      pending.current = true; setBusy(true); setError("");
      const gesture = event.nativeEvent;
      void Promise.resolve().then(() => actions.autonomy(gesture, managerId, projectId, policy)).catch(() => setError("Couldn't save this setting — try again")).finally(() => { pending.current = false; setBusy(false); });
    }}>{label}</button>)}</div><p>You'll still approve merges, installs and deletes.</p>{error && <p role="alert">{error}</p>}</div>;
}
