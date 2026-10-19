import { useRef, useState } from "react";
import { isImeComposition } from "../../shared/lib/keyboard";
import { decideNewMonoGoalRoute, type MonoGoalRoutingContext, type MonoGoalSubmission } from "../monos/model/monoGoalRouting";

export type BossGoalRoute = {
  context: MonoGoalRoutingContext;
  submit: (text: string, submission: MonoGoalSubmission) => Promise<boolean>;
};

export function BossGoalForm({ route }: { route?: BossGoalRoute }) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string>();
  const pending = useRef(false);
  const retained = useRef<{ signature: string; submission: MonoGoalSubmission; rejected: boolean } | null>(null);

  async function send() {
    if (!route || !text.trim() || pending.current) return;
    const source = text;
    const signature = JSON.stringify([route.context.ownerId, source]);
    pending.current = true;
    setSending(true);
    setError(undefined);
    try {
      if (retained.current?.signature !== signature || retained.current.rejected) {
        const choice = { mode: "goal", override: "grand" } as const;
        const decision = decideNewMonoGoalRoute({ text: source, attachmentCount: 0, choice, context: route.context });
        retained.current = { signature, rejected: false, submission: {
          ownerId: route.context.ownerId, choice, reason: decision.reason,
          requestId: crypto.randomUUID(), userMessageId: crypto.randomUUID(),
        } };
      }
      const accepted = await route.submit(source, retained.current.submission);
      if (!accepted) {
        retained.current.rejected = true;
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

  return <form className="command-map-ask" aria-label="Tell the Boss" onSubmit={event => { event.preventDefault(); void send(); }}>
    <div>
      <span aria-hidden="true">✦</span>
      <textarea rows={1} aria-label="Tell the Boss what you want" placeholder="Tell the Boss what you want…"
        value={text} disabled={!route || sending} onChange={event => { setText(event.target.value); setError(undefined); }}
        onKeyDown={event => {
          if (event.key !== "Enter" || event.shiftKey || isImeComposition(event.nativeEvent)) return;
          event.preventDefault(); void send();
        }} />
      <button type="submit" disabled={!route || sending || !text.trim()}>{sending ? "Sending…" : "Send"}</button>
    </div>
    {!route && <p>Boss requests are unavailable. Open the Boss chat to continue.</p>}
    {error && <p role="alert">{error}</p>}
  </form>;
}
