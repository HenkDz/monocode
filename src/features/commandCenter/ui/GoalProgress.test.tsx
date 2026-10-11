// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { goals, roster, runs, sessions, now } from "../fixtures/syntheticMission";
import { selectGoalTimeline, type GoalTimeline } from "../model/timeline";
import { GoalProgress } from "./GoalProgress";

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
const fixture = () => structuredClone({ goals, roster, runs, sessions, now });
const timeline = () => selectGoalTimeline({ ...fixture(), goalId: goals[0].id })!;
const phase = (name: string) => [...host.querySelectorAll<HTMLButtonElement>("[data-phase]")].find(button => button.querySelector("span + span")?.textContent === name)!;
function render(value?: GoalTimeline) { root.render(<GoalProgress timeline={value} onOpenTarget={() => {}} />); }
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

it("shows Not started for a recorded review still queued before submission", async () => {
  const value = timeline();
  const review = value.lanes.find(lane => lane.review)!;
  expect(review.spans.some(span => span.kind === "queued" && span.ongoing)).toBe(true);
  await act(async () => render(value));
  expect(phase("Review").querySelector("small")?.textContent).toBe("Not started");
  await act(async () => phase("Review").click());
  expect(host.querySelector(".mc-phase-detail")?.textContent).toContain("awaiting turn start");
});

it("keeps unknown legacy review timing unavailable", async () => {
  const input = fixture();
  input.runs[0].dispatches = input.runs[0].dispatches!.filter(dispatch => dispatch.id !== "dispatch-synthetic-review");
  const value = selectGoalTimeline({ ...input, goalId: goals[0].id })!;
  expect(value.lanes.find(lane => lane.review)?.spans.some(span => span.id === "legacy")).toBe(true);
  await act(async () => render(value));
  expect(phase("Review").querySelector("small")?.textContent).toBe("Unknown");
  await act(async () => phase("Review").click());
  expect(host.querySelector(".mc-phase-detail")?.textContent).toContain("exact phase boundaries are unavailable");
  expect(host.textContent).not.toContain("Not started");
});

it("does not call Review unstarted when another review attempt has unknown or observed execution", async () => {
  for (const observed of [false, true]) {
    const value = timeline(); const review = value.lanes.find(lane => lane.review)!;
    value.lanes.push({ ...review, id: "another-review", attempt: "another-attempt", spans: [{
      id: observed ? "turn:another" : "legacy", kind: "unknown", label: "Turn phases unknown", detail: "Unavailable phase coverage", ...(observed ? { start: now - 10_000 } : {}),
    }] });
    await act(async () => render(value));
    expect(phase("Review").querySelector("small")?.textContent).toBe("Unknown");
    expect(host.textContent).not.toContain("Not started");
  }
});

it("preserves unknown planning and work phases and missing review evidence", async () => {
  await act(async () => render());
  for (const name of ["Planning", "Working", "Review"]) {
    expect(phase(name).querySelector("small")?.textContent).toBe("Unknown");
    await act(async () => phase(name).click());
    expect(host.querySelector(".mc-phase-detail")?.textContent).toContain("exact phase boundaries are unavailable");
  }
});

it("lists overlapping waits separately instead of inventing a total duration", async () => {
  const value = timeline();
  const waits = value.lanes.flatMap(lane => lane.spans).filter(span => ["waiting", "queued"].includes(span.kind));
  expect(waits.length).toBeGreaterThan(1);
  await act(async () => render(value));
  expect(phase("Waiting").querySelector("small")?.textContent).toBe(`${waits.length} spans`);
  await act(async () => phase("Waiting").click());
  expect(host.querySelector(".mc-phase-detail")?.textContent).toContain("Review outstanding");
  expect(host.querySelector(".mc-phase-detail")?.textContent).toContain("Awaiting turn start");
});

it("shows only captured compaction durations and counts multiple spans without adding them", async () => {
  const value = timeline();
  const lane = value.lanes[0];
  lane.spans.push({ id: "compaction-one", kind: "compaction", label: "Compaction", start: now - 4_000, end: now - 2_000, detail: "Recorded receipt" });
  await act(async () => render(value));
  expect(phase("Compaction").querySelector("small")?.textContent).toBe("0m 2s");
  lane.spans.push({ id: "compaction-two", kind: "compaction", label: "Compaction", start: now - 3_000, detail: "End unknown" });
  await act(async () => render(value));
  expect(phase("Compaction").querySelector("small")?.textContent).toBe("2 spans");
  await act(async () => phase("Compaction").click());
  expect(host.querySelector(".mc-phase-detail")?.textContent).toContain("0m 2s");
  expect(host.querySelector(".mc-phase-detail")?.textContent).toContain("Unknown");
});
