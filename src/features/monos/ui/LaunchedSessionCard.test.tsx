// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { LaunchedSessionCard } from "./LaunchedSessionCard";
import {
  agentLiveStateLabel,
  type AgentLiveState,
} from "../../agents/model/agentLiveState";
import {
  launchedSessionState,
  type LaunchedSessionView,
} from "../model/monoSpawnedSessions";
import type { MonoSpawnedSession } from "../../sessions/model/session";

const launch: MonoSpawnedSession = {
  sessionId: "app-review",
  title: "Review latest PR",
  cwd: "/repo",
  harness: "codex",
  model: "gpt-6",
};

it("renders canonical launched-session states with one shared cue and preserves opening", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div"),
    root = createRoot(host),
    onOpen = vi.fn();
  const states: AgentLiveState[] = [
    { status: "thinking" },
    { status: "running-tool", detail: "Run tests" },
    { status: "queued", reason: "paused", detail: "Queue paused" },
    { status: "blocked", reason: "storage", detail: "Repair AGENTS.md" },
    { status: "needs-you", reason: "approval", detail: "Approve tests" },
    { status: "failed", reason: "error", detail: "Test failure" },
    { status: "waiting-review", waitingOn: "Reviewer" },
    { status: "done" },
  ];
  try {
    for (const state of states) {
      await act(async () =>
        root.render(
          <LaunchedSessionCard
            launch={launch}
            view={{ state, title: "Updated review" }}
            open
            onOpen={onOpen}
          />,
        ),
      );
      const button = host.querySelector("button")!;
      expect(button.dataset.state).toBe(state.status);
      expect(button.getAttribute("aria-pressed")).toBe("true");
      expect(button.getAttribute("aria-label")).toBe(
        `Open session Updated review, ${agentLiveStateLabel(state).toLowerCase()}`,
      );
      expect(button.textContent).toContain(agentLiveStateLabel(state));
      expect(button.textContent).toContain("repo");
      expect(
        host.querySelectorAll('.agent-state-cue[aria-hidden="true"]'),
      ).toHaveLength(1);
      expect(button.querySelector("button, [tabindex]")).toBeNull();
      await act(async () => button.click());
    }
    expect(onOpen).toHaveBeenCalledTimes(states.length);
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});

it("never infers done for an unopened or untracked session and stays disabled without an open handler", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div"),
    root = createRoot(host);
  try {
    for (const view of [
      undefined,
      { title: launch.title, state: launchedSessionState(undefined) },
    ] satisfies (LaunchedSessionView | undefined)[]) {
      await act(async () =>
        root.render(<LaunchedSessionCard launch={launch} view={view} />),
      );
      const button = host.querySelector("button")!;
      expect(button.disabled).toBe(true);
      expect(button.getAttribute("aria-pressed")).toBe("false");
      expect(button.textContent).not.toContain("Done");
      expect(button.getAttribute("aria-label")).not.toContain("done");
      expect(button.dataset.state).toBe(view ? "idle" : undefined);
    }
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});
