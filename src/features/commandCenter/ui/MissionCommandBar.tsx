import { useEffect, useRef, useState } from "react";
import { isImeComposition } from "../../../shared/lib/keyboard";
import { ChevronRight, Terminal } from "../../../shared/ui/icons";
import {
  decideNewMonoGoalRoute,
  directProjectRoutingEnabled,
  type MonoGoalRouteChoice,
  type MonoGoalRouteDecision,
  type MonoGoalRoutingContext,
  type MonoGoalSubmission,
} from "../../monos/model/monoGoalRouting";
import { MonoGoalRoute } from "../../monos/ui/MonoGoalRoute";
import "./missionCommandBar.css";

export function MissionCommandBar({ goalRouting, onSubmit, open = true }: {
  goalRouting?: MonoGoalRoutingContext;
  onSubmit: (text: string, submission?: MonoGoalSubmission, event?: Event) => Promise<boolean>;
  open?: boolean;
}) {
  const [text, setText] = useState("");
  const [choice, setChoice] = useState<MonoGoalRouteChoice>({ mode: "chat", override: "auto" });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();
  const field = useRef<HTMLTextAreaElement>(null);
  const pending = useRef(false);
  const request = useRef<{
    signature: string; submission: MonoGoalSubmission; route: MonoGoalRouteDecision; rejected: boolean;
  } | null>(null);
  const [retained, setRetained] = useState<{ signature: string; route: MonoGoalRouteDecision }>();
  const signature = JSON.stringify([goalRouting?.ownerId, text, choice]);

  useEffect(() => {
    if (!open) return;
    const focus = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.target instanceof Element && event.target.closest("input, textarea, select, [contenteditable=true], [role=dialog]")) return;
      if (document.querySelector('[aria-modal="true"]')) return;
      event.preventDefault();
      field.current?.focus();
    };
    window.addEventListener("keydown", focus);
    return () => window.removeEventListener("keydown", focus);
  }, [open]);

  async function send(event?: Event) {
    const message = text.trim();
    if (!goalRouting || !open || pending.current || !message) return;
    pending.current = true;
    setSubmitting(true);
    setError(undefined);
    try {
      let submission: MonoGoalSubmission | undefined;
      if (choice.mode === "goal") {
        if (request.current?.signature !== signature || request.current.rejected) {
          const route = decideNewMonoGoalRoute({ text, attachmentCount: 0, choice, context: goalRouting });
          const previous = request.current?.signature === signature ? request.current.submission : undefined;
          const project = route.kind === "manager" ? route.project : undefined;
          const sameRoute = previous?.reason === route.reason && previous.projectId === project?.id &&
            previous.managerMonoId === project?.managerMonoId;
          request.current = {
            signature, route, rejected: false,
            submission: {
              ownerId: goalRouting.ownerId,
              requestId: sameRoute ? previous.requestId : crypto.randomUUID(),
              userMessageId: sameRoute ? previous.userMessageId : crypto.randomUUID(),
              choice: { ...choice }, reason: route.reason,
              ...(project ? { projectId: project.id, managerMonoId: project.managerMonoId } : {}),
            },
          };
        }
        setRetained(request.current);
        submission = request.current.submission;
      }
      const accepted = await (event?.isTrusted ? onSubmit(submission ? text : message, submission, event) : onSubmit(submission ? text : message, submission));
      if (!accepted) {
        if (request.current) request.current.rejected = true;
        setRetained(undefined);
        setError("Message was not accepted. Your draft is still here.");
        return;
      }
      request.current = null;
      setRetained(undefined);
      setText("");
      setChoice({ mode: "chat", override: "auto" });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      pending.current = false;
      setSubmitting(false);
    }
  }

  return <form data-manager-composer data-mono-id={goalRouting?.ownerId} className="mc-command-bar" aria-label="Mission command" onSubmit={event => { event.preventDefault(); void send(); }}>
    <div className="mc-command-entry">
      <Terminal aria-hidden="true" />
      <textarea ref={field} rows={Math.min(4, text.split("\n").length)} aria-label="Ask or assign work" placeholder="Ask a question, or assign a goal…"
        value={text} disabled={!goalRouting || submitting} onChange={event => { setText(event.target.value); setError(undefined); }}
        onKeyDown={event => {
          if (event.key !== "Enter" || event.shiftKey || isImeComposition(event.nativeEvent)) return;
          event.preventDefault();
          void send(event.nativeEvent);
        }} />
      <kbd aria-hidden="true">/</kbd>
    </div>
    <div className="mc-command-bottom">
      <div className="mc-command-routing">
        {goalRouting && <MonoGoalRoute context={goalRouting} text={text} attachmentCount={0} choice={choice}
          route={retained?.signature === signature ? retained.route : undefined}
          onChange={setChoice} disabled={submitting} />}
        {directProjectRoutingEnabled() && choice.mode === "chat" && <span className="mc-command-chat-route">Send to Grand Orch</span>}
      </div>
      <button type="button" onClick={event => void send(event.nativeEvent)} className="mc-command-send" disabled={!goalRouting || submitting || !text.trim()}>
        {submitting ? "Sending…" : "Send"} <ChevronRight aria-hidden="true" />
      </button>
    </div>
    {!goalRouting && <p className="mc-command-notice">Set up Grand Orch to ask a question or assign a goal.</p>}
    {error && <p className="mc-command-notice" role="alert">{error}</p>}
  </form>;
}
