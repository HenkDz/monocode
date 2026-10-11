import { describe, expect, it } from "vitest";
import { selectGoalTimeline, type TimelineLane } from "./timeline";
import { goals, roster, runs, sessions, now } from "../fixtures/syntheticMission";
import type { GoalViewInput } from "./goalView";

const fixture = () => structuredClone({ goals, roster, runs, sessions, now });
const timeline = (input: GoalViewInput) => selectGoalTimeline({ ...input, goalId: input.goals[0].id })!;
const worker = (input: GoalViewInput) => timeline(input).lanes.find(lane => lane.attempt === "dispatch-synthetic-build")!;
const turn = (lane: TimelineLane) => lane.spans.find(span => span.id.startsWith("turn:") || span.id.includes(":turn:"))!;

describe("CC7E recorded delegation timeline", () => {
  it("uses only attributed turns and never turns call counts or tool metadata into phases", () => {
    const input = fixture();
    input.sessions[1].blocks.push({ id: "unrelated", role: "user", text: "Other goal", startedAt: now - 2000, durationMs: 1000 });
    const result = timeline(input);
    expect(result.lanes.flatMap(lane => lane.spans).some(span => span.id.includes("unrelated"))).toBe(false);
    expect(turn(worker(input)).kind).toBe("unknown");
    expect(result.lanes.flatMap(lane => lane.spans).every(span => !["model", "tool"].includes(span.kind))).toBe(true);
  });

  it("draws dispatch-to-turn-start queue time independently of first content", () => {
    const input = fixture();
    input.sessions[2].blocks[0].turnMetrics!.firstTokenAt = now - 1_700_000;
    const spans = worker(input).spans;
    expect(spans.find(span => span.id === "queue")).toMatchObject({ start: now - 1_810_000, end: now - 1_800_000 });
    expect(spans.find(span => span.id.startsWith("content:"))).toMatchObject({ kind: "milestone", start: now - 1_700_000 });
  });

  it("shows never-started queued review and current storage blocker without inventing its onset", () => {
    const input = fixture();
    const review = timeline(input).lanes.find(lane => lane.attempt === "dispatch-synthetic-review")!;
    expect(review.spans.find(span => span.kind === "queued")).toMatchObject({ start: now - 690_000, ongoing: true });
    const blocked = review.spans.find(span => span.kind === "blocked")!;
    expect(blocked.start).toBe(now);
    expect(blocked.end).toBeUndefined();
    expect(blocked.ongoing).toBeUndefined();
    expect(blocked.detail).toContain("Start time unavailable");
    expect(review.spans.some(span => span.id.startsWith("turn:"))).toBe(false);
  });

  it("retains concurrent worker execution and overlapping review outstanding time", () => {
    const input = fixture();
    input.runs[0].tasks[2].monoGoalId = input.goals[0].id;
    const result = timeline(input);
    const build = turn(result.lanes.find(lane => lane.attempt === "dispatch-synthetic-build")!);
    const search = turn(result.lanes.find(lane => lane.attempt === "dispatch-synthetic-search")!);
    expect(search.start).toBeLessThan(build.end!);
    expect(search.ongoing).toBe(true);
    expect(result.lanes.find(lane => lane.role === "manager")!.spans.find(span => span.id === "review:dispatch-synthetic-review")).toMatchObject({ kind: "waiting", ongoing: true });
  });

  it("deduplicates out-of-order compaction receipts, joining separately recorded boundaries", () => {
    const input = fixture();
    input.sessions[2].blocks[0].turnMetrics!.compactions = [
      { id: "second", startedAt: now - 900_000, endedAt: now - 800_000 },
      { id: "first", endedAt: now - 1_400_000 }, { id: "first", startedAt: now - 1_500_000 },
      { id: "second", startedAt: now - 900_000, endedAt: now - 800_000 },
    ];
    const compactions = worker(input).spans.filter(span => span.kind === "compaction");
    expect(compactions).toHaveLength(2);
    expect(compactions.map(span => span.start)).toEqual([now - 1_500_000, now - 900_000]);
    expect(compactions[0].end).toBe(now - 1_400_000);
  });

  it("leaves one-sided compaction boundaries unknown instead of spanning the rest of a turn", () => {
    const input = fixture();
    input.sessions[2].blocks[0].turnMetrics!.compactions = [{ id: "start-only", startedAt: now - 900_000 }, { id: "end-only", endedAt: now - 800_000 }];
    const spans = worker(input).spans.filter(span => span.kind === "compaction");
    expect(spans.find(span => span.id.endsWith("start-only"))).toMatchObject({ start: now - 900_000, end: undefined });
    expect(spans.find(span => span.id.endsWith("end-only"))).toMatchObject({ start: undefined, end: now - 800_000 });
    expect(spans.every(span => !span.ongoing)).toBe(true);
  });

  it("marks reversed or conflicting receipts unknown and never produces a negative duration", () => {
    const input = fixture();
    input.sessions[2].blocks[0].durationMs = undefined;
    input.sessions[2].blocks[0].turnMetrics = { endedAt: now - 2_000_000, compactions: [
      { id: "reversed", startedAt: now - 800_000, endedAt: now - 900_000 },
      { id: "conflict", startedAt: now - 900_000 }, { id: "conflict", startedAt: now - 800_000 },
    ] };
    const lane = worker(input);
    expect(turn(lane).end).toBeUndefined();
    expect(lane.spans.filter(span => span.id.startsWith("compaction:")).every(span => span.kind === "unknown" && span.end == null)).toBe(true);
  });

  it("uses unloaded immutable turn snapshots including compactions", () => {
    const input = fixture();
    input.sessions = input.sessions.filter(session => session.id !== "synthetic-builder-chat");
    input.runs[0].dispatches![0].turnMetrics = { compactions: [{ id: "saved", startedAt: now - 900_000, endedAt: now - 800_000 }] };
    expect(turn(worker(input))).toMatchObject({ start: now - 1_800_000, end: now - 700_000 });
    expect(worker(input).spans.some(span => span.id.endsWith("saved"))).toBe(true);
  });

  it("keeps report delivery separate from execution", () => {
    const lane = worker(fixture());
    expect(lane.spans.find(span => span.id === "delivery")).toMatchObject({ kind: "waiting", start: now - 700_000, end: now - 650_000 });
    expect(lane.spans.find(span => span.id === "report")?.start).toBe(now - 650_000);
  });

  it("preserves provider turn end before app settlement across loaded and unloaded snapshots", () => {
    const input = fixture();
    const dispatch = input.runs[0].dispatches![0];
    dispatch.turnMetrics = { endedAt: now - 750_000 };
    dispatch.durationMs = 1_050_000;
    input.sessions[2].blocks[0].turnMetrics!.endedAt = now - 750_000;
    input.sessions[2].blocks[0].durationMs = 1_050_000;
    expect(turn(worker(input)).end).toBe(now - 750_000);
    input.sessions = input.sessions.filter(session => session.id !== dispatch.sessionId);
    expect(turn(worker(input)).end).toBe(now - 750_000);
    dispatch.turnMetrics = {};
    expect(turn(worker(input)).end).toBe(now - 750_000);
    expect(worker(input).spans.find(span => span.id === "finish")!.start).toBe(now - 700_000);
  });

  it("keeps two reviews linked to exact implementation attempts with the fix between them", () => {
    const input = fixture();
    const [build, review] = input.runs[0].tasks;
    review.status = "completed";
    delete review.monoGoalId;
    input.runs[0].dispatches![1] = { ...input.runs[0].dispatches![1], state: "completed", stage: "settled", finishedAt: now - 500_000 };
    const fix = { ...input.runs[0].dispatches![0], id: "fix-attempt", startedAt: now - 400_000, dispatchedAt: now - 400_000, turnStartedAt: now - 390_000, finishedAt: now - 200_000, reportedAt: now - 190_000, turnBlockId: "fix-turn" };
    input.runs[0].dispatches!.push(fix);
    build.lastDispatchId = fix.id;
    input.sessions[2].blocks.push({ id: "fix-turn", role: "user", text: "Fix", startedAt: fix.turnStartedAt, durationMs: 190_000 });
    const review2 = { ...review, id: "review-two", activeDispatchId: "review-two-attempt", status: "running" as const, reviewOf: { taskId: build.id, dispatchId: fix.id } };
    input.runs[0].tasks.push(review2);
    input.runs[0].dispatches!.push({ ...input.runs[0].dispatches![1], id: "review-two-attempt", taskId: review2.id, state: "running", startedAt: now - 180_000, dispatchedAt: now - 180_000, finishedAt: undefined });
    const result = timeline(input);
    const reviews = result.lanes.filter(lane => lane.review);
    expect(reviews).toHaveLength(2);
    expect(reviews.map(lane => lane.review!.dispatchId)).toEqual(["dispatch-synthetic-build", "fix-attempt"]);
    expect(result.lanes.filter(lane => lane.assignment === build.title).map(lane => lane.attempt)).toEqual(["dispatch-synthetic-build", "fix-attempt"]);
    expect(result.lanes.find(lane => lane.role === "manager")!.spans.filter(span => span.id.startsWith("review:"))).toHaveLength(2);
  });

  it("retains interruptions and retries without extending an old unknown turn into a new attempt", () => {
    const input = fixture();
    const first = input.runs[0].dispatches![0];
    first.state = "interrupted"; first.finishedAt = undefined; first.reportedAt = undefined;
    input.sessions[2].blocks[0].durationMs = undefined; input.sessions[2].blocks[0].turnMetrics = undefined;
    input.sessions[2].busy = true;
    const retry = { ...first, id: "retry", state: "running" as const, startedAt: now - 300_000, dispatchedAt: now - 300_000, turnStartedAt: now - 290_000, turnBlockId: "retry-turn" };
    input.runs[0].tasks[0].status = "running"; input.runs[0].tasks[0].activeDispatchId = retry.id;
    input.runs[0].dispatches!.push(retry);
    input.sessions[2].blocks.push({ id: "retry-turn", role: "user", text: "Retry", startedAt: retry.turnStartedAt });
    expect(turn(worker(input))).toMatchObject({ end: undefined, ongoing: false });
    expect(turn(timeline(input).lanes.find(lane => lane.attempt === "retry")!).ongoing).toBe(true);
  });

  it("does not turn restored stop_unknown/start_unknown into live execution", () => {
    const input = fixture();
    const dispatch = input.runs[0].dispatches![0];
    dispatch.state = "stop_unknown"; dispatch.finishedAt = undefined; dispatch.reportedAt = undefined;
    input.sessions[2].blocks[0].durationMs = undefined; input.sessions[2].blocks[0].turnMetrics = undefined;
    input.sessions[2].busy = true; input.runs[0].tasks[0].status = "interrupted";
    expect(turn(worker(input))).toMatchObject({ end: undefined, ongoing: false });
    dispatch.state = "start_unknown";
    expect(turn(worker(input)).ongoing).toBe(false);
    for (const state of ["start_unknown", "stop_unknown"] as const) {
      input.runs[0].dispatches![1].state = state;
      const review = timeline(input).lanes.find(lane => lane.attempt === "dispatch-synthetic-review")!;
      expect(review.spans.some(span => span.kind === "queued" && span.ongoing)).toBe(false);
    }
  });

  it("leaves legacy assignments untimed and never derives completion from updatedAt", () => {
    const input = fixture(); input.runs[0].dispatches = [];
    input.goals[0].state = "done"; input.goals[0].updatedAt = now + 1_000_000;
    const result = timeline(input);
    expect(result.live).toBe(false);
    expect(result.end).toBeLessThan(now);
    expect(result.lanes.filter(lane => lane.role === "worker").every(lane => lane.spans[0].start == null)).toBe(true);
  });

  it("deduplicates dispatch/turn identities and is stable when records arrive out of order", () => {
    const input = fixture();
    const baseline = timeline(input);
    input.runs[0].dispatches!.push(structuredClone(input.runs[0].dispatches![0]));
    input.runs[0].dispatches!.reverse();
    input.sessions[2].blocks.push(structuredClone(input.sessions[2].blocks[0]));
    expect(timeline(input)).toEqual(baseline);
  });

  it("merges partial duplicate dispatch receipts without order-dependent spans", () => {
    const input = fixture();
    const baseline = timeline(input);
    const duplicate = { ...input.runs[0].dispatches![0], finishedAt: undefined, reportedAt: undefined, turnStartedAt: undefined };
    input.runs[0].dispatches!.push(duplicate);
    expect(timeline(input)).toEqual(baseline);
    input.runs[0].dispatches!.reverse();
    expect(timeline(input)).toEqual(baseline);
    duplicate.reportedAt = now - 640_000;
    const lane = worker(input);
    expect(lane.spans.some(span => span.id === "conflict")).toBe(true);
    expect(lane.spans.some(span => span.id === "report" || span.id === "delivery")).toBe(false);
    const conflicted = timeline(input);
    input.runs[0].dispatches!.reverse();
    expect(timeline(input)).toEqual(conflicted);
  });

  it("rejects invalid Date epochs and overflowing computed ends instead of crashing the UI", () => {
    const input = fixture();
    input.runs[0].dispatches![0].finishedAt = Number.MAX_VALUE;
    input.sessions[2].blocks[0].startedAt = 8.64e15;
    input.sessions[2].blocks[0].durationMs = 2000;
    input.sessions[2].blocks[0].turnMetrics!.endedAt = Number.MAX_VALUE;
    const result = timeline(input);
    expect(() => new Date(result.start).toISOString()).not.toThrow();
    expect(() => new Date(result.end).toISOString()).not.toThrow();
    expect(turn(worker(input)).end).toBeUndefined();
    expect(worker(input).spans.some(span => span.id === "finish")).toBe(false);
  });

  it("marks missing review references unavailable and handles cyclic legacy links", () => {
    const input = fixture();
    input.runs[0].tasks[1].reviewOf!.dispatchId = "missing";
    expect(timeline(input).lanes.find(lane => lane.review)!.review!.available).toBe(false);
    delete input.runs[0].tasks[1].monoGoalId;
    input.runs[0].tasks[1].reviewOf!.taskId = input.runs[0].tasks[1].id;
    expect(timeline(input).lanes.some(lane => lane.review)).toBe(false);
  });

  it("does not activate an unfinished old goal turn in a shared busy Manager chat", () => {
    const input = fixture();
    input.sessions[1].blocks[0].durationMs = undefined; input.sessions[1].blocks[0].turnMetrics = undefined;
    input.sessions[1].blocks.push({ id: "other-goal", role: "user", text: "Other", startedAt: now - 1000 });
    input.sessions[1].busy = true;
    expect(turn(timeline(input).lanes.find(lane => lane.role === "manager")!).ongoing).toBe(false);
  });

  it("returns unavailable for a missing goal", () => {
    expect(selectGoalTimeline({ ...fixture(), goalId: "missing" })).toBeUndefined();
  });
});
