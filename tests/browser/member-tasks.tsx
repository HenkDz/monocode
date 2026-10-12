import { createRoot } from "react-dom/client";
import { MemberWorkLog } from "../../src/features/monos/ui/MemberWorkLog";
import { AgentTranscript } from "../../src/features/sessions/ui/AgentTranscript";
import { orchestrator } from "../../src/features/orchestration/model/orchestration";
import type {
  OrchestrationRun,
  OrchestrationTask,
} from "../../src/features/orchestration/model/orchestrationState";
import type { Mono } from "../../src/features/monos/model/mono";
import { publishCardSessions } from "../../src/features/monos/model/monoCards";
import "../../src/styles/index.css";
import "../../src/features/monos/ui/workbench.css";

const mode = new URLSearchParams(location.search).get("mode");
document.documentElement.classList.toggle("theme-light", mode === "light");
const member: Mono = {
  id: "rowan",
  role: "member",
  reportsTo: "manager",
  name: "Rowan",
  projects: ["/fixture"],
  mascot: "cat",
  color: "#6ba",
};
localStorage.setItem(
  "monocode:mono-roster",
  JSON.stringify([
    { ...member, id: "manager", role: "manager", name: "Browser Link Manager" },
    member,
  ]),
);
const task = (id: string, status: OrchestrationTask["status"]) =>
  ({
    id,
    memberId: member.id,
    sessionId: id,
    title: `${id} — inspect native browser routing and reconcile retained worktrees`,
    prompt: "Verify the routing and report the result.",
    status,
    lastDispatchId: id,
  }) as OrchestrationTask;
const current =
  mode === "history"
    ? []
    : [
        task("Waiting for your decision", "running"),
        task("Running Windows checks", "running"),
        ...Array.from({ length: 18 }, (_, i) =>
          task(`Queued assignment ${i}`, "queued"),
        ),
      ];
const history = Array.from({ length: 120 }, (_, i) => ({
  ...task(`Completed assignment ${i}`, "completed"),
  accepted: true,
  acceptedDispatchId: `Completed assignment ${i}`,
  completionOutcome: "no-changes" as const,
}));
let runs = [
  { leadId: "original-manager", tasks: [...current, ...history], dispatches: [] },
] as unknown as OrchestrationRun[];
const listeners = new Set<() => void>();
orchestrator.snapshot = () => runs;
orchestrator.subscribe = listener => { listeners.add(listener); return () => { listeners.delete(listener); }; };
Object.assign(window, { retireFixtureTask: (id: string, reuse: boolean) => {
  const owner = runs.find(run => run.tasks.some(task => task.id === id))!;
  const selected = owner.tasks.find(task => task.id === id)!;
  runs = runs.map(run => ({ ...run, tasks: run.tasks.filter(task => task !== selected) }));
  if (reuse) runs.push({ ...owner, leadId: "other-manager", tasks: [{ ...selected, prompt: "Other Manager's assignment", sessionId: "other-worker" }] });
  for (const listener of listeners) listener();
} });
publishCardSessions(
  [
    {
      id: "Waiting for your decision",
      title: "",
      harness: "codex",
      needsInput: true,
    },
  ],
  () => {},
);

createRoot(document.getElementById("root")!).render(
  <main className="flex h-dvh min-h-0 flex-col bg-background-base text-content">
    <div data-fixture-chat className="min-h-0 flex-1">
      <AgentTranscript
        blocks={[
          {
            id: "question",
            role: "user",
            text: "What is your specialty in the team?",
          },
          {
            id: "reply",
            role: "assistant",
            text: "I’m Rowan, the team’s Rust and Windows implementation specialist. I verify focused fixes, review native integration, and report to the project Manager.",
          },
        ]}
        agentName="Rowan"
        hideTurnMetrics
      />
    </div>
    <div
      data-fixture-work
      className="shrink-0 overflow-y-auto"
      style={{ maxHeight: "min(30dvh, 256px)" }}
    >
      <MemberWorkLog member={member} />
    </div>
    <div className="mx-auto w-full max-w-4xl shrink-0 p-4">
      <textarea
        aria-label="Message Rowan"
        className="w-full resize-none rounded-lg border border-content/20 p-3 text-sm"
        defaultValue="Keep my draft"
      />
    </div>
  </main>,
);
