import { useRef, useState } from "react";
import type { GoalNextStep } from "../model/goalNextAction";
import "./goalNextAction.css";

export function GoalNextAction({ step, onAction }: { step: GoalNextStep; onAction: (event: Event, step: GoalNextStep) => Promise<void> }) {
  const pending = useRef(false);
  const [busy, setBusy] = useState(false), [sent, setSent] = useState(false), [error, setError] = useState("");
  return <div className="goal-next-action" data-decision-ui>
    {step.message && <p>{step.message}</p>}
    <button type="button" disabled={busy || sent} onClick={event => {
      if (pending.current) return;
      pending.current = true; setBusy(true); setError("");
      void Promise.resolve().then(() => onAction(event.nativeEvent, step)).then(() => setSent(step.action === "continue" || step.action === "start"), () => setError("Couldn't reach the Manager. Open its conversation and try again."))
        .finally(() => { pending.current = false; setBusy(false); });
    }}>{sent ? "Sent to Manager" : step.label}</button>
    {sent && <span role="status">Waiting for the Manager's next update</span>}
    {error && <p role="alert">{error}</p>}
  </div>;
}
