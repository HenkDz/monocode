import { expect, it } from "vitest";
import { approvedMemberReview } from "./memberReview";
import type { OrchestrationRun, OrchestrationTask } from "./orchestrationState";

it("requires the team's Reviewer, exact implementation dispatch and completed review dispatch", () => {
  const target = {
    id: "implementation",
    lastDispatchId: "impl-2",
  } as OrchestrationTask;
  const review = {
    id: "review",
    memberId: "reviewer",
    status: "completed",
    lastDispatchId: "review-1",
    reviewOf: { taskId: "implementation", dispatchId: "impl-2" },
    reviewVerdict: {
      decision: "approve",
      notes: "Diff and tests checked",
      dispatchId: "review-1",
    },
  } as OrchestrationTask;
  const run = { tasks: [target, review] } as OrchestrationRun;
  expect(approvedMemberReview(run, target, "reviewer")).toBe(review);
  expect(
    approvedMemberReview(
      run,
      { ...target, lastDispatchId: "impl-3" },
      "reviewer",
    ),
  ).toBeUndefined();
  expect(approvedMemberReview(run, target, "other-reviewer")).toBeUndefined();
  for (const stale of [
    { ...review, status: "running" as const },
    { ...review, lastDispatchId: "review-2" },
    {
      ...review,
      reviewVerdict: { ...review.reviewVerdict!, decision: "changes" as const },
    },
  ])
    expect(
      approvedMemberReview(
        { ...run, tasks: [target, stale] },
        target,
        "reviewer",
      ),
    ).toBeUndefined();
});
