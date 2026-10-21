import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { agentLiveStateLabel } from "../../agents/model/agentLiveState";
import { listMonos, monosSnapshot, subscribeMonos } from "../../monos/model/mono";
import { monoManagerGoals } from "../../monos/model/monoManagerGoals";
import { MonoCodexStorageNotice } from "../../monos/ui/MonoCodexStorageNotice";
import { codexFullAccessRepairAllowed } from "../../monos/model/monoCodexStorage";
import { QuestionForm } from "../../sessions/ui/QuestionForm";
import { UsageLimitNotice } from "../../sessions/ui/UsageLimitNotice";
import { useAttentionSources } from "../model/useAttentionSources";
import { goalElapsedLabel } from "../model/goalView";
import { attentionHistory, executeAttentionAction, selectAttention, type AttentionAction, type AttentionCallbacks, type AttentionCategory, type AttentionInput, type AttentionItem, type AttentionReceipt } from "../model/attention";
import "./attentionQueue.css";
import { AttentionDetails } from "./AttentionDetails";
import { CircleAlert } from "../../../shared/ui/icons";
import type { GoalNextStep } from "../model/goalNextAction";

// CC7D shell hook: reuse Team map's full-view lifecycle and request routing.
export const ATTENTION_QUEUE_SCOPE = "command-center:attention";
export function AttentionQueueNav({ onOpen, compact = false }: { onOpen: () => void; compact?: boolean }) {
  return <button type="button" onClick={onOpen} title="Attention queue" aria-label="Attention queue"
    className={`flex shrink-0 items-center gap-2 rounded-md text-[13px] text-content/65 hover:bg-content/8 hover:text-content focus-visible:outline-accent ${compact ? "mx-auto size-8 justify-center" : "mx-2 my-1 h-8 px-2"}`}>
    <CircleAlert className="size-3.5" strokeWidth={1.75} aria-hidden="true" />{!compact && "Attention"}
  </button>;
}

export type AttentionQueueViewProps = {
  input: AttentionInput;
  callbacks: AttentionCallbacks;
  readInput?: () => AttentionInput;
  open: boolean;
  onClose: () => void;
  onOpenMissionControl?: () => void;
  sourceError?: string;
  presentation?: "page" | "panel";
  coveredGoalSteps?: readonly GoalNextStep[];
  items?: readonly AttentionItem[];
  integrated?: boolean;
};

export function AttentionQueueView({ input, callbacks, readInput, open, onClose, onOpenMissionControl, sourceError, presentation = "page", coveredGoalSteps, items, integrated = false }: AttentionQueueViewProps) {
  const titleId = useId();
  const Heading = presentation === "panel" ? "h2" : "h1";
  const current = useMemo(() => (items ?? selectAttention(input)).filter(item => !coveredGoalSteps?.some(step => item.status === "open" && (
    step.action === "continue" && item.source === "continue" && item.leadId === step.managerId ||
    step.action === "start" && item.source === "manager-request" && item.sessionId === step.sessionId && item.messageId === `manager-request-${step.request?.userMessageId}` ||
    step.action === "open" && ["approval", "question"].includes(item.source) && step.key === `${item.sessionId}:${item.source}:${item.requestId}`
  ))), [input, coveredGoalSteps, items]);
  const [filter, setFilter] = useState<"open" | "history" | AttentionCategory>("open");
  const [receipts, setReceipts] = useState<Record<string, AttentionReceipt>>({});
  const [history, setHistory] = useState<AttentionItem[]>([]);
  const observed = useRef<AttentionItem[]>([]);
  const pending = useRef(new Set<string>());
  const submitted = useRef(new Set<string>());
  const [now, setNow] = useState(Date.now);
  const latest = useRef({ input, callbacks, readInput });
  latest.current = { input, callbacks, readInput };
  useEffect(() => {
    const retained = attentionHistory(observed.current, current, receipts, input);
    observed.current = [...current, ...retained];
    setHistory(retained);
  }, [current, receipts, input]);
  useEffect(() => {
    if (!open) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    const key = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (event.target instanceof Element && event.target.closest("[data-attention-details]")) return;
      event.preventDefault(); event.stopPropagation(); onClose();
    };
    if (!integrated && presentation === "page") window.addEventListener("keydown", key, true);
    return () => { clearInterval(timer); window.removeEventListener("keydown", key, true); };
  }, [open, onClose, integrated, presentation]);

  async function run(item: AttentionItem, action: AttentionAction, payload?: Parameters<typeof executeAttentionAction>[4]) {
    if (pending.current.has(item.id)) throw Error("An action is already pending for this request.");
    const mutation = !["inspect", "compare", "reveal", "resume-at-reset"].includes(action);
    const submissionKey = JSON.stringify([item.id, item.revision]);
    if (mutation && submitted.current.has(submissionKey)) throw Error("Action submitted. Waiting for the conversation to acknowledge it.");
    pending.current.add(item.id);
    setReceipts(previous => ({ ...previous, [item.id]: { status: "pending", message: "Action pending…", revision: item.revision, submitted: submitted.current.has(submissionKey) } }));
    try {
      const active = latest.current;
      const result = await executeAttentionAction(item, action, active.readInput?.() ?? active.input, active.callbacks, payload);
      if (mutation) submitted.current.add(submissionKey);
      const awaiting = submitted.current.has(submissionKey);
      setReceipts(previous => ({ ...previous, [item.id]: { status: awaiting ? "sent" : "success",
        message: awaiting ? "Action submitted · awaiting source acknowledgement" : action === "resume-at-reset" ? "Resume schedule updated" : "Opened", revision: item.revision, submitted: awaiting } }));
      return result;
    } catch (error) {
      setReceipts(previous => ({ ...previous, [item.id]: { status: "error", message: error instanceof Error ? error.message : String(error), revision: item.revision, submitted: submitted.current.has(submissionKey) } }));
      throw error;
    } finally { pending.current.delete(item.id); }
  }
  const perform = (item: AttentionItem, action: AttentionAction, payload?: Parameters<typeof executeAttentionAction>[4]) => {
    void run(item, action, payload).catch(() => {});
  };
  const all = [...current, ...history];
  const visible = all.filter(item => filter === "history" ? item.status !== "open" : item.status === "open" && (filter === "open" || item.category === filter));
  const filters = [["open", "Open"], ["approval", "Approvals"], ["decision", "Decisions"], ["blocker", "Blockers"], ["failure", "Failures"], ["history", "History"]] as const;

  function row(item: AttentionItem) {
    const receipt = receipts[item.id]?.revision === item.revision ? receipts[item.id] : undefined;
    const settled = item.status !== "open";
    const locked = receipt?.status === "pending" || submitted.current.has(JSON.stringify([item.id, item.revision]));
    const session = input.sessions.find(session => session.id === item.sessionId);
    const evidence = <>
      <p className="aq-path">{[item.project, ...item.goals, item.owner].join(" → ")}</p>
      <p className="aq-owner">{item.route === "lead" ? "Routed through lead · worker requests stay with their lead" : "User-owned request"}
        {item.taskId && ` · Task ${item.taskId}`}{item.dispatchId && ` · Attempt ${item.dispatchId}`}</p>
      {item.requestId != null && <p className="aq-owner">Request {item.requestId} · Conversation {item.sessionId}</p>}
      {item.sessionIds.length > 1 && <p className="aq-owner">Affects {item.sessionIds.length} conversations: {item.sessionIds.join(", ")}</p>}
      {item.detail && item.source !== "storage" && !(item.source === "question" && item.route === "user") && <pre className="aq-evidence">{item.detail}</pre>}
    </>;
    return <article className="aq-item" tabIndex={-1} key={item.id} aria-label={item.title} data-task-id={item.taskId} data-session-id={item.sessionId} data-attention-source={item.source} data-attention-status={item.status} aria-busy={receipt?.status === "pending"}>
      <span className="aq-symbol" aria-hidden="true">{item.category === "decision" ? "?" : item.category === "failure" ? "×" : "!"}</span>
      <div className="aq-body"><header><h2>{item.title}</h2><span className="aq-state">{settled ? item.status === "resolved" ? "Resolved" : item.status === "replaced" ? "Replaced request" : "No longer available" : agentLiveStateLabel(item.state)}</span></header>
        {presentation === "page" ? evidence : <><p className="aq-path">{item.project} · {item.owner} · {item.route === "user" ? "User-owned request" : "Routed through lead"}</p>
          {(item.source !== "storage" || settled || item.repairable === false) && <AttentionDetails title={`${item.title} evidence`}>{evidence}</AttentionDetails>}</>}
        {!settled && <>
          {item.source === "storage" && item.repairable !== false ? <fieldset className="aq-question" disabled={locked}><legend className="sr-only">Storage recovery</legend><MonoCodexStorageNotice key={item.revision} detail={item.detail} blockedContext={item.state.detail}
            allowFullAccess={!!session && codexFullAccessRepairAllowed(session)} explicitElevated={session?.windowsSandbox === "elevated"}
            renderDetails={content => open && <AttentionDetails title="Storage evidence">{presentation === "panel" && evidence}{content}</AttentionDetails>}
            onRepair={async () => { await run(item, "repair"); }} onResolve={async resolution => { await run(item, "repair", { resolution }); }}
            onCompare={callbacks.compare ? async () => (await run(item, "compare"))! : undefined}
            onReveal={callbacks.reveal ? async () => { await run(item, "reveal"); } : undefined} /></fieldset> : null}
          {item.source === "question" && item.route === "user" && item.question && <fieldset className="aq-question" disabled={locked}>
            <legend className="sr-only">Answer {item.title}</legend><QuestionForm key={item.revision} prompt={item.question}
              onInteraction={requestId => callbacks.questionInteraction?.(item.sessionId, requestId)}
              onReply={(_, reply) => perform(item, "answer", { reply })} />
          </fieldset>}
          {item.source === "usage" && session?.usageLimit && <fieldset disabled={locked} className="aq-question">
            <legend className="sr-only">Usage recovery</legend><UsageLimitNotice limit={session.usageLimit} variant="mono"
              onResume={() => perform(item, "resume")}
              onResumeAtReset={enabled => perform(item, "resume-at-reset", { enabled })} />
          </fieldset>}
          <div className="aq-actions">
            {item.source === "approval" && item.route === "user" && <>
              <button className="aq-primary" type="button" disabled={locked} onClick={() => perform(item, "allow")}>Allow once</button>
              <button type="button" disabled={locked} onClick={() => perform(item, "deny")}>Deny</button>
            </>}
            {item.source === "continue" && item.route === "user" && <button type="button" disabled={locked} onClick={() => perform(item, "continue")}>Continue Manager</button>}
            {item.source === "manager-request" && item.route === "user" && <button type="button" disabled={locked || !callbacks.continueRequest} onClick={() => perform(item, "continue")}>Continue this request</button>}
            {item.source === "delivery" && session?.queuedMessages?.[0]?.id === item.messageId && <button type="button" disabled={locked || session?.queueStatus !== "paused"} onClick={() => perform(item, "retry-delivery")}>Retry delivery</button>}
            <button type="button" disabled={receipt?.status === "pending"} onClick={() => perform(item, "inspect")}>{item.source === "automation" ? "Review in Automations" : item.route === "lead" ? item.source === "task" ? "Review retry with lead" : "Open lead" : "Open conversation"}</button>
          </div>
        </>}
        {receipt && <p className="aq-receipt" role={receipt.status === "error" ? "alert" : "status"}>{receipt.message}</p>}
        {settled && <p className="aq-owner">{item.status === "resolved" ? "The original request is settled." : "Retained for inspection. Actions are disabled; inspect the current conversation."}</p>}
      </div>
      {(item.createdAt != null || presentation === "page") && <time className="aq-time" title={item.createdAt == null ? undefined : new Date(item.createdAt).toLocaleString()}>{item.createdAt == null ? "Age unavailable" : goalElapsedLabel(Math.max(0, now - item.createdAt))}</time>}
    </article>;
  }
  if (integrated && !all.length && !sourceError) return null;
  return <section className="attention-queue" data-presentation={presentation} aria-label={integrated ? "Requests and blockers" : undefined} aria-labelledby={integrated ? undefined : titleId} hidden={!open} inert={!open || undefined}>
    {!integrated && <header className="aq-toolbar"><div>{presentation === "page" && <p className="aq-eyebrow">Command center</p>}<Heading className="aq-title" id={titleId}>Attention</Heading>{presentation === "page" && <p>Requests and blockers across your loaded conversations and team runs.</p>}</div>
      <div className="aq-actions">{presentation === "page" && onOpenMissionControl && <button type="button" onClick={onOpenMissionControl}>Back to goals</button>}<button type="button" onClick={onClose}>{presentation === "panel" ? "Close" : "Back to conversation"}</button></div>
    </header>}
    <div className="aq-scroll"><nav className="aq-filters" aria-label="Attention filters">{filters.map(([value, label]) => <button type="button" key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>
      {label} · {all.filter(item => value === "history" ? item.status !== "open" : item.status === "open" && (value === "open" || item.category === value)).length}
    </button>)}</nav>
      {!integrated && <p className="aq-coverage">Blockers first, then oldest recorded request. Task failures need review in their lead; retry preserves the failed attempt.</p>}
      {sourceError && <p className="aq-receipt" role="alert">{sourceError}</p>}
      {visible.map(row)}
      {!visible.length && <p className="aq-empty">{filter === "history" ? "No resolved or replaced requests observed yet." : "No attention items in this view."}</p>}
      {!integrated && <p className="aq-footer">Active blockers remain visible until the source clears them. Unavailable or replaced requests stay in History.</p>}
    </div>
  </section>;
}

export function AttentionQueue({ sessions, runs, callbacks, selectedAccount, isLocalSession, readSessions, readRuns, ...props }: Omit<AttentionQueueViewProps, "input" | "readInput"> & {
  sessions: AttentionInput["sessions"]; runs: AttentionInput["runs"]; selectedAccount?: AttentionInput["selectedAccount"];
  isLocalSession?: AttentionInput["isLocalSession"];
  readSessions: () => AttentionInput["sessions"]; readRuns: () => AttentionInput["runs"];
}) {
  const rosterSnapshot = useSyncExternalStore(subscribeMonos, monosSnapshot);
  const goalsSnapshot = useSyncExternalStore(monoManagerGoals.subscribe, monoManagerGoals.snapshot);
  const { repairs, automations, sourceError } = useAttentionSources(props.open);
  const input = useMemo(() => ({ sessions, runs, roster: listMonos(), goals: monoManagerGoals.goals(), selectedAccount, isLocalSession, repairs, automations }), [sessions, runs, rosterSnapshot, goalsSnapshot, selectedAccount, isLocalSession, repairs, automations]);
  return <AttentionQueueView {...props} sourceError={sourceError} input={input} callbacks={callbacks}
    readInput={() => ({ ...input, sessions: readSessions(), runs: readRuns(), roster: listMonos(), goals: monoManagerGoals.goals() })} />;
}
