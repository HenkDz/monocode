import { expect, it } from "vitest";
import { memberContinuity } from "./memberContinuity";
import type { OrchestrationRun, OrchestrationTask } from "./orchestrationState";

it("carries the member's own recent project summaries and sender hand-off", () => {
  const task = { id: "new", memberId: "backend", handoffNote: "UI: API shape is settled" } as OrchestrationTask;
  const run = { tasks: [
    { id: "one", memberId: "backend", title: "Routing", result: "Added endpoint" },
    { id: "two", memberId: "ui", title: "UI", result: "Other member context" },
    task,
  ] } as OrchestrationRun;
  const note = memberContinuity(run, task);
  expect(note).toContain("Routing: Added endpoint");
  expect(note).toContain("UI: API shape is settled");
  expect(note).not.toContain("Other member context");
});
