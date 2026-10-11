import { expect, it } from "vitest";
import type { Session } from "../../sessions/model/session";
import { dropContextWindow } from "../../sessions/model/contextUsage";
import {
  canRotateContext,
  rotationInputGrowth,
  taskContextBudget,
} from "./taskContextBudget";

it.each([
  [{ used: 699, effectiveCompactionThreshold: 1000 }, 50, false, 750],
  [{ used: 700, effectiveCompactionThreshold: 1000 }, 50, true, 750],
  [{ used: 549, window: 1000 }, 50, false, 600],
  [{ used: 550, window: 1000 }, 50, true, 600],
  [
    { used: 700, window: 2000, effectiveCompactionThreshold: 1000 },
    50,
    true,
    750,
  ],
] as const)(
  "uses the exact projected threshold (%#)",
  (usage, growth, rotate, threshold) => {
    expect(taskContextBudget(usage, growth)).toEqual({
      threshold,
      projected: usage.used + growth,
      rotate,
    });
  },
);

it.each([
  undefined,
  { used: 900 },
  { used: 900, window: 0 },
  { used: 900, window: -1 },
  { used: 900, window: Infinity },
  { used: 900, effectiveCompactionThreshold: NaN },
])("keeps unknown or invalid windows unknown (%#)", (usage) => {
  expect(taskContextBudget(usage).threshold).toBeUndefined();
  expect(taskContextBudget(usage).rotate).toBe(false);
});

it("does not use a stale model's window or threshold", () => {
  const usage = dropContextWindow({
    used: 999,
    window: 1000,
    effectiveCompactionThreshold: 900,
  });
  expect(taskContextBudget(usage).rotate).toBe(false);
});

it.each([-1, NaN, Infinity])("rejects invalid input growth %s", (growth) => {
  expect(taskContextBudget({ used: 999, window: 1000 }, growth).rotate).toBe(
    false,
  );
});

it("projects text and recent tool work without consulting billed metrics", () => {
  const blocks: Session["blocks"] = [
    { id: "old", role: "user", text: "x".repeat(5000) },
    {
      id: "last",
      role: "user",
      text: "go",
      turnMetrics: { inputTokens: 9_000_000 },
    },
    {
      id: "tool",
      role: "tool",
      text: "",
      tool: { detail: "read", preview: { kind: "shell", output: "ok" } },
    },
    { id: "reply", role: "assistant", text: "done" },
    { id: "draft", role: "user", text: "unsent", draft: true },
  ];
  expect(rotationInputGrowth(blocks.slice(0, -1), "é")).toBe(14);
  expect(rotationInputGrowth(blocks, "é")).toBe(14);
  expect(rotationInputGrowth([], "é")).toBe(2);
});

it("permits an idle boundary", () => {
  expect(canRotateContext({ blocks: [] })).toBe(true);
});

it.each([
  { busy: true },
  { pendingSwitch: {} },
  { pendingQuestion: {} },
  { backgroundTasks: ["tool"] },
  { worktreePreparing: true },
  { codexStoragePreparing: true },
  { worktreeRemoved: true },
  { blocks: [{ role: "assistant", streaming: true }] },
  { blocks: [{ role: "tool", tool: { status: "running" } }] },
  { blocks: [{ role: "approval", approval: { requestId: 1 } }] },
])("holds rotation during a live operation or decision (%#)", (patch) => {
  expect(canRotateContext({ blocks: [], ...patch } as Session)).toBe(false);
});

it("allows settled tools and decisions", () => {
  expect(
    canRotateContext({
      blocks: [
        { id: "tool", role: "tool", text: "", tool: { status: "completed" } },
        {
          id: "approval",
          role: "approval",
          text: "",
          approval: { requestId: 1, decided: "deny" },
        },
      ],
    }),
  ).toBe(true);
});
