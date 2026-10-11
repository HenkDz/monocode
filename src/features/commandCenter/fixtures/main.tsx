import { useState } from "react";
import { createRoot } from "react-dom/client";
import "../../../styles/index.css";
import { selectGoalViews, type GoalTarget } from "../model/goalView";
import { MissionControlView } from "../ui/MissionControl";
import { goals, roster, runs, sessions, now } from "./syntheticMission";

const view = selectGoalViews({ goals, roster, runs, sessions, now });

function Harness() {
  const [target, setTarget] = useState<GoalTarget>();
  const [closed, setClosed] = useState(false);
  return (
    <div className="flex h-screen min-w-0 flex-col bg-background-base font-sans text-content">
      <div className="shrink-0 border-b border-stroke px-4 py-2 text-xs text-content/70">
        Synthetic CC7C fixture · no app database, provider or native runtime
      </div>
      <MissionControlView view={view} onOpenTarget={setTarget} onClose={() => setClosed(true)} open={!target && !closed} />
      {target && <section aria-label="Synthetic target view" className="p-6">
        <h1 className="mb-4 text-xl">Synthetic target view</h1>
        <output data-testid="opened-target">{JSON.stringify(target)}</output>
        <button className="mt-6 block rounded border border-stroke px-3 py-2 focus-visible:outline-2 focus-visible:outline-accent" onClick={() => setTarget(undefined)}>Return to Mission control</button>
      </section>}
      {closed && <section className="p-6">
        <p>Mission control closed</p>
        <button onClick={() => setClosed(false)}>Reopen Mission control</button>
      </section>}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<Harness />);
