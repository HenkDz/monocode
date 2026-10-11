import { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import { AttentionQueueView } from "../../ui/AttentionQueue";
import type { AttentionCallbacks, AttentionInput } from "../../model/attention";
import { approval, syntheticAttention } from "./syntheticAttention";

type Event = { action: string; sessionId: string; requestId?: number; payload?: unknown; target?: string };
type HarnessControls = {
  events: Event[];
  settleApproval: () => void;
  replaceApproval: () => void;
  changeSourceWithoutRender: () => void;
};
declare global { interface Window { attentionFixture: HarnessControls } }
document.documentElement.classList.toggle("theme-light", new URLSearchParams(location.search).get("theme") === "light");
const presentation = new URLSearchParams(location.search).get("presentation") === "panel" ? "panel" : "page";

function Harness() {
  const [input, setInput] = useState<AttentionInput>(syntheticAttention);
  const [open, setOpen] = useState(true);
  const [closeCount, setCloseCount] = useState(0);
  const [target, setTarget] = useState<string>();
  const current = useRef(input);
  current.current = input;
  const events = useRef<Event[]>([]);
  const finishApproval = useRef<() => void>(() => {});
  const update = (next: AttentionInput) => { current.current = next; setInput(next); };
  const callbacks: AttentionCallbacks = {
    approval: (sessionId, requestId, decision) => {
      events.current.push({ action: "approval", sessionId, requestId, payload: decision });
      return new Promise<void>(resolve => { finishApproval.current = () => {
        resolve();
        update({ ...current.current, sessions: current.current.sessions.map(session => session.id === sessionId ? {
          ...session, blocks: session.blocks.map(block => block.approval?.requestId === requestId ? { ...block, approval: { ...block.approval, decided: decision } } : block),
        } : session) });
      }; });
    },
    question: (sessionId, requestId, reply) => {
      events.current.push({ action: "question", sessionId, requestId, payload: reply });
      return Promise.resolve().then(() => update({ ...current.current, sessions: current.current.sessions.map(session => session.id === sessionId ? { ...session, pendingQuestion: undefined } : session) }));
    },
    repair: async (sessionId, resolution) => {
      events.current.push({ action: "repair", sessionId, payload: resolution });
      throw Error("Synthetic repair failed: file is busy. Both versions remain preserved.");
    },
    compare: async sessionId => {
      events.current.push({ action: "compare", sessionId });
      return { monoContent: "Synthetic Mono instructions", sourceContent: "Synthetic account instructions" };
    },
    reveal: async sessionId => { events.current.push({ action: "reveal", sessionId }); },
    resume: sessionId => { events.current.push({ action: "resume", sessionId }); },
    resumeAtReset: (sessionId, enabled) => { events.current.push({ action: "resume-at-reset", sessionId, payload: enabled }); },
    retryDelivery: async sessionId => {
      events.current.push({ action: "retry-delivery", sessionId });
      throw Error("Synthetic delivery retry failed. The original message remains queued.");
    },
    continueManager: async sessionId => { events.current.push({ action: "continue", sessionId }); },
    inspect: sessionId => {
      // The existing App callback resolves worker sessions through their lead.
      const leadId = current.current.sessions.find(session => session.id === sessionId)?.orchestrationLeadId;
      const targetId = current.current.runs.find(run => run.leadId === leadId)?.ownerSessionId ?? sessionId;
      events.current.push({ action: "inspect", sessionId, target: targetId });
      setTarget(targetId); setOpen(false);
    },
  };
  window.attentionFixture = {
    events: events.current,
    settleApproval: () => finishApproval.current(),
    replaceApproval: () => update({ ...current.current, sessions: current.current.sessions.map(session => session.id === "manager" ? { ...session, blocks: [approval(73, "Replacement permission request")] } : session) }),
    changeSourceWithoutRender: () => { current.current = { ...current.current, sessions: current.current.sessions.map(session => session.id === "manager" ? { ...session, blocks: [approval(74, "New source request")] } : session) }; },
  };
  return <main className="flex h-screen min-w-0 flex-col bg-background-base font-sans text-content">
    <p className="shrink-0 border-b border-stroke px-4 py-2 text-xs text-content/70">Synthetic CC7D fixture · isolated browser · no provider or profile writes</p>
    <AttentionQueueView input={input} readInput={() => current.current} callbacks={callbacks} open={open} presentation={presentation}
      onClose={() => { setOpen(false); setCloseCount(count => count + 1); }} />
    {!open && <section className="p-6" aria-label="Synthetic conversation">
      <h1 className="mb-4 text-xl">{target ? `Conversation: ${target}` : "Attention closed"}</h1>
      <output data-testid="close-count">{closeCount}</output>
      <button className="mt-4 block rounded border border-stroke px-3 py-2" onClick={() => { setOpen(true); setTarget(undefined); }}>Reopen Attention</button>
    </section>}
  </main>;
}
createRoot(document.getElementById("root")!).render(<Harness />);
