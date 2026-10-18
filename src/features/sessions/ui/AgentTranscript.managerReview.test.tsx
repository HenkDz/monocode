// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AgentTranscript } from "./AgentTranscript";
import {
  ProjectManagerReview,
  ProjectManagerStatus,
} from "../../orchestration/ui/ProjectManagerReview";
import { managerReviewTimeline } from "../../orchestration/model/projectManagerTimeline";
import type { OrchestrationRun } from "../../orchestration/model/orchestrationState";
import type { Block } from "../model/session";
import { prStatusKey } from "../../source-control/hooks/usePrStatus";
import { SessionPrSummary } from "./SessionPrSummary";
import { chatPrTurns } from "../model/chatPullRequests";
import type { WorktreePr } from "../../source-control/model/pullRequests";

const view = vi.hoisted(() => ({ statuses: new Map() }));
vi.mock("../../source-control/hooks/usePrStatus", async (original) => ({
  ...(await original<object>()),
  usePrStatusCache: () => view.statuses,
}));
vi.mock("../../inbox/model/githubTasks", () => ({
  formatRelativeTime: vi.fn(() => "Just now"),
  githubPrDiff: vi.fn(async () => ({
    additions: 5,
    deletions: 1,
    files: [{}],
  })),
}));
vi.mock("../../inbox/hooks/useGithubPrChecks", () => ({
  useGithubPrChecks: () => ({
    loading: false,
    error: null,
    checks: { headOid: "head", checks: [{ name: "build", workflow: "CI", state: "pass", url: null, startedAt: null, completedAt: null }] },
  }),
}));

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.spyOn(HTMLElement.prototype, "animate").mockImplementation(
    () => ({ cancel: vi.fn() }) as unknown as Animation,
  );
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  view.statuses = new Map();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const task = {
  id: "docs",
  title: "Docs",
  sessionId: "worker",
  harness: "codex",
  model: "codex:test",
  status: "completed",
  accepted: true,
  lastDispatchId: "dispatch",
  acceptedDispatchId: "dispatch",
  prUrl: "https://github.com/example/repo/pull/1",
  prReadyAt: 300,
  prReadyTurnId: "first",
  workspace: { checkoutCwd: "/worker", branch: "docs" },
};
const run = {
  leadId: "manager",
  cwd: "/repo",
  status: "active",
  tasks: [task],
} as OrchestrationRun;
const initial: Block[] = [
  { id: "first", role: "user", text: "Prepare docs", startedAt: 100 },
  { id: "reply", role: "assistant", text: "The PR is ready." },
];

it("renders existing ordinary transcripts as one chip per referencing turn without PR cards", async () => {
  const entries: WorktreePr[] = [1, 2].map(number => ({ cwd: "/repo", links: [], verifiedAt: 1, pr: { number, title: "History", url: `https://github.com/example/repo/pull/${number}`, state: "merged" } }));
  const blocks: Block[] = [{ id: "first", role: "user", text: "Cleanup report", startedAt: 100 }, { id: "report", role: "assistant", text: "PR #1 merged. PR #2 merged." }, { id: "next", role: "user", text: "yes", startedAt: 500 }, { id: "answer", role: "assistant", text: "Done." }];
  await act(async () => root.render(<AgentTranscript blocks={blocks} inlineWork turnAccessories={new Map([...chatPrTurns(blocks, entries)].map(([id, turn]) => [id, <SessionPrSummary key={id} turn={turn} />]))} />));
  const first = host.querySelector('[data-transcript-turn="first"]')!;
  expect(first.textContent).toContain("2 PRs referenced · all merged");
  expect(host.querySelector('[data-transcript-turn="next"]')!.textContent).not.toContain("PRs referenced");
  expect(host.textContent).not.toContain("Open diff");
  expect(host.querySelector("[id^=session-pr-]")).toBeNull();
});

async function render(blocks: Block[], current = run) {
  const accessories = new Map(
    [...managerReviewTimeline([current], blocks)].map(([id, runs]) => [
      id,
      <div key={id}>
        {runs.map((group) => (
          <ProjectManagerReview key={group.leadId} run={group} historical />
        ))}
      </div>,
    ]),
  );
  await act(async () =>
    root.render(
      <>
        <ProjectManagerStatus run={current} />
        <AgentTranscript
          blocks={blocks}
          inlineWork
          turnAccessories={accessories}
        />
      </>,
    ),
  );
}

it("keeps the same ready card before a new turn and jumps from the ready count with focus highlighting", async () => {
  const scroll = vi
    .spyOn(HTMLElement.prototype, "scrollIntoView")
    .mockImplementation(() => {});
  await render(initial);
  const card = host.querySelector<HTMLElement>("#manager-review-docs")!;
  expect(
    card
      .closest("[data-transcript-turn]")
      ?.getAttribute("data-transcript-turn"),
  ).toBe("first");
  const newer: Block[] = [
    ...initial,
    { id: "next", role: "user", text: "Start the next task", startedAt: 500 },
    { id: "progress", role: "assistant", text: "Starting new work." },
  ];
  await render(newer);
  expect(host.querySelectorAll("#manager-review-docs")).toHaveLength(1);
  expect(host.querySelector("#manager-review-docs")).toBe(card);
  const nextTurn = host.querySelector('[data-transcript-turn="next"]')!;
  expect(
    card.compareDocumentPosition(nextTurn) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  const count = [
    ...host.querySelectorAll<HTMLButtonElement>("nav button"),
  ].find((button) => button.textContent === "1 ready")!;
  await act(async () => count.click());
  expect(scroll).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(card);
  expect(card.className).toContain("focus-visible:outline-accent");
});

it("updates merged, closed and sent-back state in the same historical card", async () => {
  await render(initial);
  const card = host.querySelector("#manager-review-docs")!;
  for (const state of ["merged", "closed"] as const) {
    view.statuses = new Map([
      [prStatusKey("/worker", "docs"), { url: task.prUrl, state }],
    ]);
    await render(initial);
    expect(host.querySelector("#manager-review-docs")).toBe(card);
    expect(card.getAttribute("aria-label")).toBe(
      `${state === "merged" ? "Merged" : "Closed"}: Docs`,
    );
    expect(
      [...card.querySelectorAll("button")].some(
        (button) => button.textContent === "Send back",
      ),
    ).toBe(false);
  }
  view.statuses = new Map();
  await render(initial, {
    ...run,
    tasks: [{ ...run.tasks[0], status: "running", accepted: false }],
  });
  expect(host.querySelector("#manager-review-docs")).toBe(card);
  expect(card.getAttribute("aria-label")).toBe("Sent back: Docs");
  expect(
    [...host.querySelectorAll("nav button")]
      .find((button) => button.textContent === "0 ready")
      ?.getAttribute("disabled"),
  ).not.toBeNull();
});

it("cycles slim team PR lines from the focused task with Alt Shift N", async () => {
  await render(initial, { ...run, tasks: [run.tasks[0], { ...run.tasks[0], id: "second", prUrl: "https://github.com/example/repo/pull/2" }] });
  const first = host.querySelector<HTMLButtonElement>("#manager-review-docs")!;
  const second = host.querySelector<HTMLButtonElement>("#manager-review-second")!;
  first.focus();
  await act(async () => first.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "n", altKey: true, shiftKey: true })));
  expect(document.activeElement).toBe(second);
  await act(async () => second.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "n", altKey: true, shiftKey: true })));
  expect(document.activeElement).toBe(first);
});
