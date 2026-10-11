import { useState } from "react";
import { createRoot } from "react-dom/client";
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { MonoComposer } from "../../src/features/monos/ui/MonoComposer";
import type { MonoGoalSubmission } from "../../src/features/monos/model/monoGoalRouting";
import type { RuntimeMode } from "../../src/features/sessions/model/session";
import { setComposerDraft } from "../../src/features/sessions/model/draftCache";
import "../../src/styles/index.css";

mockWindows("main");
mockIPC(() => null);
const params = new URLSearchParams(location.search);
document.documentElement.classList.toggle(
  "theme-light",
  params.get("theme") === "light",
);
const floating = params.get("surface") === "floating";
const sessionId = floating ? "floating:cc5c-fixture" : "cc5c-fixture";
setComposerDraft(
  sessionId,
  "Fix the DZDistro inventory cost calculation and add a regression test.",
);
const context = {
  ownerId: "fixture-grand",
  projects: [
    {
      id: "dzdistro",
      name: "DZDistro",
      path: "C:/fixtures/dzdistro",
      managerMonoId: "fixture-dzdistro-manager",
      available: true,
    },
    {
      id: "monocode",
      name: "MonoCode",
      path: "C:/fixtures/monocode",
      managerMonoId: "fixture-monocode-manager",
      available: true,
    },
  ],
};

function Fixture() {
  const [mode, setMode] = useState<RuntimeMode>("supervised");
  const [submission, setSubmission] = useState<MonoGoalSubmission>();
  return (
    <main className="flex min-h-screen items-center justify-center bg-background-base p-4 text-content">
      <section
        className={`w-full rounded-xl border border-content/10 bg-content/3 p-3 ${floating ? "max-w-96" : "max-w-3xl"}`}
      >
        <header className="mb-6 px-2">
          <h1 className="text-[15px] font-semibold">Grand Orchestrator</h1>
          <p className="mt-1 text-[12px] text-content/45">
            {floating ? "Floating composer" : "Embedded composer"} · Synthetic
            routing harness
          </p>
        </header>
        <MonoComposer
          sessionId={sessionId}
          name="Grand Orchestrator"
          runtimeMode={mode}
          onRuntimeModeChange={setMode}
          goalRouting={context}
          onSubmit={(_text, _attachments, goal) => {
            setSubmission(goal);
            return true;
          }}
        />
        {submission ? (
          <pre data-submission className="mt-4 overflow-auto px-2 text-[11px]">
            {JSON.stringify(submission)}
          </pre>
        ) : null}
      </section>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<Fixture />);
