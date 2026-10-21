import { useRef, useState } from "react";
import { isImeComposition } from "../../shared/lib/keyboard";
import { decideNewMonoGoalRoute, type MonoGoalRoutingContext, type MonoGoalSubmission } from "../monos/model/monoGoalRouting";

export type BossGoalRoute = {
  context: MonoGoalRoutingContext;
  submit: (text: string, submission: MonoGoalSubmission) => Promise<boolean>;
};

export function BossGoalForm({ route, manager }: { route?: BossGoalRoute; manager?: { id: string; name: string; send?: (text: string) => Promise<boolean> } }) {
  const target = manager?.id ?? route?.context.ownerId ?? "boss";
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const text = drafts[target] ?? "";
  const setText = (value: string) => setDrafts(previous => ({ ...previous, [target]: value }));
  const available = manager ? !!manager.send : !!route;
  const recipient = manager?.name ?? "Boss";
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string>();
  const pending = useRef(false);
  const retained = useRef<{ signature: string; submission: MonoGoalSubmission; rejected: boolean } | null>(null);

  async function send() {
    if (!available || !text.trim() || pending.current) return;
    const source = text;
    const signature = JSON.stringify([target, source]);
    pending.current = true;
    setSending(true);
    setError(undefined);
    try {
      if (!manager && route && (retained.current?.signature !== signature || retained.current.rejected)) {
        const choice = { mode: "goal", override: "grand" } as const;
        const decision = decideNewMonoGoalRoute({ text: source, attachmentCount: 0, choice, context: route.context });
        retained.current = { signature, rejected: false, submission: {
          ownerId: route.context.ownerId, choice, reason: decision.reason,
          requestId: crypto.randomUUID(), userMessageId: crypto.randomUUID(),
        } };
      }
      const accepted = manager ? await manager.send!(source) : await route!.submit(source, retained.current!.submission);
      if (!accepted) {
        if (retained.current) retained.current.rejected = true;
        setError("Request was not accepted. Your draft is still here.");
        return;
      }
      retained.current = null;
      setText("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      pending.current = false;
      setSending(false);
    }
  }

  return <form className="command-map-ask" data-manager={!!manager} aria-label={`Tell the ${recipient}`} onSubmit={event => { event.preventDefault(); void send(); }}>
    <div>
      <span className="command-map-recipient">{manager ? "🧭" : "✦"} {recipient}</span>
      <textarea rows={1} aria-label={`Tell the ${recipient} what you want`} placeholder={`Tell the ${recipient} what you want…`}
        value={text} disabled={!available || sending} onChange={event => { setText(event.target.value); setError(undefined); }}
        onKeyDown={event => {
          if (event.key !== "Enter" || event.shiftKey || isImeComposition(event.nativeEvent)) return;
          event.preventDefault(); void send();
        }} />
      <button type="submit" disabled={!available || sending || !text.trim()}>{sending ? "Sending…" : "Send"}</button>
    </div>
    {!available && <p>{recipient} requests are unavailable. Open the {recipient} chat to continue.</p>}
    {error && <p role="alert">{error}</p>}
  </form>;
}
