import { useId, useRef, useState, type MouseEvent } from "react";
import type { Mono } from "../../monos/model/mono";
import type { DecisionCommand, MonoDecision, ProjectAutonomy } from "../../monos/model/monoDecisions";
import { projectName } from "../../../shared/lib/paths";
import { decisionActorName, unreadableDecisionPreview, type DecisionView, type OwnedDecision } from "../model/decisionView";
import "./decisions.css";

export type DecisionUiCommand = Exclude<DecisionCommand, { action: "ingest" }>;
export type DecisionUiActions = {
  command(event: Event, managerId: string, requestId: string, command: DecisionUiCommand): Promise<unknown>;
  reraise(event: Event, managerId: string, requestId: string, oldDecisionId: string): Promise<void>;
  openProject(projectId: string): void;
};

function useDecisionAction() {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ error: boolean; text: string }>();
  const pending = useRef(false);
  const receipts = useRef(new Map<string, string>());
  const run = (key: string, action: (requestId: string) => Promise<unknown>) => {
    if (pending.current) return;
    pending.current = true; setBusy(true); setNotice(undefined);
    const requestId = receipts.current.get(key) ?? `decision-${crypto.randomUUID()}`;
    receipts.current.set(key, requestId);
    void action(requestId).then(() => setNotice({ error: false, text: "Saved. Delivery follows the original work context." }),
      () => setNotice({ error: true, text: "Could not complete this action. Retry to check its retained receipt." }))
      .finally(() => { pending.current = false; setBusy(false); });
  };
  return { busy, notice, run };
}

export function DecisionCard({ item, roster, actions, disabled = false }: { item: OwnedDecision; roster: readonly Mono[]; actions: DecisionUiActions; disabled?: boolean }) {
  const { decision, managerId } = item;
  const titleId = useId();
  const { busy, notice, run } = useDecisionAction();
  const actionable = !disabled && decision.status !== "decided" && decision.deciderLevel === "user" && decision.deliveryState === "current";
  const choose = (event: MouseEvent, optionId: string) => run(`${decision.id}:${decision.resolutionVersion}:resolve:${optionId}`,
    requestId => actions.command(event.nativeEvent, managerId, requestId, { action: "resolve", decisionId: decision.id, expectedVersion: decision.resolutionVersion, optionId }));
  return <article className="decision-card" aria-labelledby={titleId} data-decision-id={decision.id} data-decision-ui>
    <ol className="decision-chain" aria-label="Escalation chain">{decision.escalationChain.map(entry =>
      <li key={entry.id} data-level={entry.level}>{decisionActorName(roster, entry.id)}</li>)}</ol>
    <h2 id={titleId}>{decision.question}</h2>
    <p className="decision-meta"><span className="decision-impact" data-impact={decision.impact}>{decision.impact === "med" ? "Medium" : decision.impact === "high" ? "High" : "Low"} impact</span><span>{projectName(decision.projectId)}</span></p>
    <p className="decision-context">{decision.context}</p>
    <div className="decision-options" aria-label="Decision options">{decision.options.map(option =>
      <button type="button" key={option.id} disabled={!actionable || busy} data-recommended={option.id === decision.recommendedOptionId}
        onClick={event => choose(event, option.id)}><span>{option.label}</span>{option.id === decision.recommendedOptionId &&
          <small>{decisionActorName(roster, decision.recommenderId!)} recommends</small>}</button>)}</div>
    {decision.operation !== "work" && <p className="decision-note">This records your answer. {decision.operation} still needs its existing explicit approval.</p>}
    <footer><button type="button" onClick={() => actions.openProject(decision.projectId)}>Open project <span aria-hidden="true">→</span></button>
      {actionable && decision.operation === "work" && <button type="button" disabled={busy} onClick={event => run(`${decision.id}:${decision.resolutionVersion}:delegate`,
        requestId => actions.command(event.nativeEvent, managerId, requestId, { action: "delegate", decisionId: decision.id, expectedVersion: decision.resolutionVersion }))}>Let the Boss decide</button>}</footer>
    {notice && <p className="decision-note" role={notice.error ? "alert" : "status"}>{notice.text}</p>}
  </article>;
}

function DecisionHistory({ decision, roster }: { decision: MonoDecision; roster: readonly Mono[] }) {
  const selected = decision.options.find(option => option.id === decision.selectedOptionId);
  const at = decision.decidedAt ?? decision.updatedAt;
  return <li className="decision-log-item"><span className="decision-log-dot" aria-hidden="true" /><div><p>{decision.question}</p>
    <strong>{selected?.label ?? "No answer recorded"}</strong><small>{decision.decidedBy && <>{decisionActorName(roster, decision.decidedBy)} · {decision.deciderLevel === "user" ? "your call" : `decided by ${decision.deciderLevel === "boss" ? "Boss" : "Manager"}`}</>}
      {decision.deliveryState === "stale" && " · recorded only, original work context changed"}</small></div>
    <time dateTime={new Date(at).toISOString()}>{new Date(at).toLocaleString()}</time></li>;
}

export function DecisionQuarantineNotice({ quarantine, actions, disabled = false }: { quarantine: DecisionView["quarantine"]; actions: DecisionUiActions; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const { busy, notice, run } = useDecisionAction();
  const contentId = useId();
  if (!quarantine.length) return null;
  return <section className="decision-quarantine" data-decision-ui><div><strong>Earlier decision history is unreadable</strong>
    <button type="button" aria-expanded={open} aria-controls={contentId} onClick={() => setOpen(!open)}>{open ? "Hide" : "View"}</button></div>
    <p>Original evidence is preserved. New decisions can continue.</p>
    {open && <div id={contentId}>{quarantine.flatMap(({ managerId, entries }) => entries.map((entry, index) =>
      <section key={`${managerId}:${index}`}><p>Preserved {new Date(entry.at).toLocaleString()}</p>
        {unreadableDecisionPreview(entry).map(item => <div className="decision-reraise" key={item.id}><p>{item.question}</p>
          <button type="button" disabled={disabled || busy} onClick={event => run(`${managerId}:${index}:${item.id}:reraise`,
            requestId => actions.reraise(event.nativeEvent, managerId, requestId, item.id))}>Ask the Manager to re-raise</button></div>)}
        <pre aria-label="Read-only preserved decision evidence">{entry.raw.slice(0, 16000)}</pre>
        {entry.raw.length > 16000 && <p>Preview limited to 16,000 characters. Full evidence remains preserved in the ledger.</p>}</section>))}</div>}
    {notice && <p role={notice.error ? "alert" : "status"}>{notice.text}</p>}
  </section>;
}

export function Decisions({ view, roster, actions, unavailable = false, presentation = "page" }: {
  view: DecisionView; roster: readonly Mono[]; actions: DecisionUiActions; unavailable?: boolean; presentation?: "page" | "rail";
}) {
  const [tab, setTab] = useState<"pending" | "log">("pending");
  const titleId = useId();
  return <section className="decisions" data-decision-ui data-presentation={presentation} aria-labelledby={titleId}>
    <header className="decisions-heading"><div><span className="decisions-eyebrow">Your calls</span><h1 id={titleId}>Decisions</h1></div>
      <span>{unavailable ? "Unavailable" : view.loading.length ? "History loading" : view.pending.length ? `${view.pending.length} need you` : "All clear"}</span></header>
    <div className="decisions-tabs" role="group" aria-label="Decision view"><button type="button" aria-pressed={tab === "pending"} onClick={() => setTab("pending")}>Needs you <span>{view.pending.length}</span></button>
      <button type="button" aria-pressed={tab === "log"} onClick={() => setTab("log")}>Decision log</button></div>
    <div className="decisions-scroll">
      {unavailable && <p role="alert">Decision history is unavailable. Actions will return when it can be loaded.</p>}
      {!!view.loading.length && <p role="status">Loading decision history for {view.loading.length} {view.loading.length === 1 ? "Manager" : "Managers"}…</p>}
      {!!view.autonomyConflicts.length && <p className="decision-note">Autonomy setting had conflicting copies; using the stricter one.</p>}
      <DecisionQuarantineNotice quarantine={view.quarantine} actions={actions} disabled={unavailable} />
      {tab === "pending" ? <>{view.pending.map(item => <DecisionCard key={`${item.managerId}:${item.decision.id}`} item={item} roster={roster} actions={actions} disabled={unavailable} />)}
        {!view.pending.length && !unavailable && !view.loading.length && <div className="decision-empty"><h2>Nothing needs your decision</h2><p>The team keeps working toward the goals.</p></div>}
        {!!view.teamPending && <p className="decision-note">{view.teamPending} {view.teamPending === 1 ? "decision is" : "decisions are"} with Managers &amp; the Boss.</p>}</>
        : view.log.length ? <ol className="decision-log">{view.log.map(({ managerId, decision }) => <DecisionHistory key={`${managerId}:${decision.id}`} decision={decision} roster={roster} />)}</ol>
        : view.autonomyChanges.length ? null : <p className="decision-empty">No recorded decisions yet.</p>}
      {tab === "log" && !!view.autonomyChanges.length && <ul className="decision-log" aria-label="Autonomy setting changes">{view.autonomyChanges.map(({ managerId, change }, index) =>
        <li className="decision-log-item" key={`${managerId}:${change.at}:${index}`}><div><p>{projectName(change.projectId)} · Autonomy copies consolidated</p>
          <strong>{[...new Set(change.replaced.map(copy => copy.value))].join(" / ")} → {change.value}</strong><small>You · explicit project setting</small></div>
          <time dateTime={new Date(change.at).toISOString()}>{new Date(change.at).toLocaleString()}</time></li>)}</ul>}
      {!unavailable && !view.loading.length && <footer className="decisions-handled"><span aria-hidden="true">✓</span><p><strong>{view.handledToday}</strong> recorded decisions handled by Managers &amp; the Boss today</p>
        <button type="button" onClick={() => setTab("log")}>View log</button></footer>}
      {!!view.pruned && <p className="decision-note">{view.pruned} older records archived. Counts reflect retained, readable history.</p>}
    </div>
  </section>;
}

export function ProjectAutonomyControl({ managerId, projectId, value, actions, disabled = false }: {
  managerId: string; projectId: string; value: ProjectAutonomy; actions: DecisionUiActions; disabled?: boolean;
}) {
  const { busy, notice, run } = useDecisionAction();
  return <div className="decision-autonomy" data-decision-ui><span>Ask me for</span><div role="group" aria-label="Project decision autonomy">
    {([["high-impact-only", "High-impact only"], ["medium-and-up", "Medium & up"], ["everything", "Everything"]] as const).map(([policy, label]) =>
      <button type="button" key={policy} disabled={disabled || busy} aria-pressed={value === policy} onClick={event => run(`${managerId}:${projectId}:${value}:${policy}`,
        requestId => actions.command(event.nativeEvent, managerId, requestId, { action: "autonomy", projectId, value: policy }))}>{label}</button>)}</div>
    <p>Merge, installs, sign-ins and protected operations still need your explicit approval.</p>
    {notice && <p role={notice.error ? "alert" : "status"}>{notice.text}</p>}
  </div>;
}
