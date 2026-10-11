import { useState } from "react";
import { createRoot } from "react-dom/client";
import "../../../../styles/index.css";
import { selectGoalTimeline } from "../../model/timeline";
import type { GoalTarget } from "../../model/goalView";
import { DelegationTimeline } from "../../ui/DelegationTimeline";
import { scenarios, type Scenario } from "./fixture";

const params = new URLSearchParams(location.search);
const key = params.get("scenario") ?? "compaction-queue";
const scenario: Scenario = key in scenarios ? key as Scenario : "compaction-queue";
document.documentElement.classList.toggle("theme-light", params.get("theme") === "light");
const timeline = selectGoalTimeline(scenarios[scenario])!;
Object.assign(window, { __cc7eTimeline: timeline });

function Harness() {
  const [target, setTarget] = useState<GoalTarget>();
  const [closed, setClosed] = useState(false);
  return <div className="flex h-screen min-w-0 flex-col bg-background-base font-sans text-content">
    <p className="shrink-0 border-b border-stroke px-4 py-2 text-xs text-content/70">Synthetic CC7E fixture · {scenario} · no app database, native runtime or provider</p>
    {!target && !closed && <DelegationTimeline timeline={timeline} onBack={() => setClosed(true)} onOpenTarget={setTarget} />}
    {target && <section aria-label="Synthetic target view" className="p-6">
      <h1 className="mb-4 text-xl">Synthetic target view</h1><output data-testid="opened-target">{JSON.stringify(target)}</output>
      <button className="mt-6 block rounded border border-stroke px-3 py-2" onClick={() => setTarget(undefined)}>Return to timeline</button>
    </section>}
    {closed && <section className="p-6"><p role="status">Timeline closed</p><button onClick={() => setClosed(false)}>Reopen timeline</button></section>}
  </div>;
}
createRoot(document.getElementById("root")!).render(<Harness />);
