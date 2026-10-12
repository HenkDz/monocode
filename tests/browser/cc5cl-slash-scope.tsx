import { useState } from "react";
import { createRoot } from "react-dom/client";
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { MonoComposer } from "../../src/features/monos/ui/MonoComposer";
import { FloatingMonoChat } from "../../src/features/monos/ui/FloatingMonoChat";
import { newSession } from "../../src/features/sessions/model/session";
import { MonoManagerGoals, type ManagerGoalHost } from "../../src/features/monos/model/monoManagerGoals";
import { appendMonoGoalOrigin, submitMonoGoal, type MonoGoalSubmission } from "../../src/features/monos/model/monoGoalRouting";
import { deliverFloatingMonoRequest, type FloatingMonoAction } from "../../src/features/monos/model/floatingMono";
import "../../src/styles/index.css";

mockWindows("cc5cl-routing-isolated");
const params = new URLSearchParams(location.search);
document.documentElement.classList.toggle("theme-light", params.get("theme") === "light");
const floating = params.get("surface") === "floating";
const context = { ownerId: "grand", projects: [
  { id: "atlas", name: "Atlas", path: "C:/synthetic/Atlas", managerMonoId: "atlas-manager", available: true },
  { id: "beacon", name: "Beacon", path: "C:/synthetic/Beacon", managerMonoId: "beacon-manager", available: true },
] };
let session = { ...newSession("codex", "C:/synthetic/Atlas"), id: "cc5cl-browser-session",
  monoTranscript: { before: null, firstBlockId: null }, monoGoalRouting: context };
const counts = { grand: 0, resolve: 0, origin: 0, ledger: 0, deliver: 0 };
let publish = (_receipt: unknown) => {};
const ledger = new MonoManagerGoals({ load: async () => null, save: async () => { counts.ledger++; } });
const project = { id: "atlas", name: "Atlas", folder: "C:/synthetic/Atlas", managerId: "atlas-engine",
  managerMonoId: "atlas-manager", managerExists: true, running: 0, needsDecision: 0, ready: 0, blocked: [], goals: [] };
const goals: ManagerGoalHost = { mayDelegate: () => true, projects: async () => [project],
  deliver: async () => { counts.deliver++; }, status: async () => ({}), ready: async () => [] };
async function submit(text: string, attachments: unknown[], submission?: MonoGoalSubmission) {
  if (!submission) throw Error("This fixture requires a user goal envelope");
  const accepted = await submitMonoGoal({ text, attachmentCount: attachments.length, origin: "user", submission }, {
    context: () => context, ledger, goals,
    resolve: async () => { counts.resolve++; return project; },
    persistOrigin: async (goal, raw) => { counts.origin++; session = { ...appendMonoGoalOrigin(session, goal, raw), monoGoalRouting: context }; },
    hasOrigin: goal => session.blocks.some(block => block.monoGoalSubmission?.requestId === goal.requestId),
    persistPending: async () => { throw Error("Unexpected pending Manager goal"); },
    persistCard: async () => {}, grand: () => { counts.grand++; return true; },
  });
  publish({ accepted, text, submission, counts: { ...counts }, goals: ledger.goals("grand") });
  return accepted;
}
mockIPC(async (command, args) => {
  if (command === "plugin:event|listen") return 1;
  if (command === "mono_chat_state") return { monoId: "grand", error: null, session,
    monos: [{ id: "grand", name: "Grand Orchestrator", mascot: "crab", color: "#aaf",
      sessionId: session.id, status: "idle", role: "orchestrator" }] };
  if (command === "mono_session_page") return { blocks: session.blocks, before: null, hasNewer: false };
  if (command === "mono_chat_action") {
    await deliverFloatingMonoRequest({ id: 1, monoId: "grand", action: args.action as FloatingMonoAction }, {
      open: async () => session, submit: (_id, text, attachments, options) => submit(text, attachments, options?.monoGoal),
      stop() {}, approval() {}, question() {}, questionInteraction() {}, reveal: async () => {}, openFile() {}, resume() {},
    }, async () => true);
  }
  return null;
});
const onShown = () => {};
function Fixture() {
  const [receipt, setReceipt] = useState<unknown>();
  publish = setReceipt;
  return <main className={floating ? "h-screen bg-background-base p-2" : "flex min-h-screen items-center justify-center bg-background-base p-4 text-content"}>
    {floating ? <FloatingMonoChat onShown={onShown} /> :
      <section className="w-full max-w-3xl rounded-xl border border-content/10 bg-content/3 p-3">
        <header className="mb-6 px-2"><h1 className="text-[15px] font-semibold">Grand Orchestrator</h1></header>
        <MonoComposer sessionId={session.id} name="Grand Orchestrator" goalRouting={context} onSubmit={submit} />
      </section>}
    <pre hidden data-receipt>{JSON.stringify(receipt)}</pre>
  </main>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
