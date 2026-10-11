// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { AgentStatusLabel } from "./AgentStatusLabel";
import {
  agentLiveStateLabel,
  selectAgentLiveState,
  type AgentLiveStatus,
} from "../model/agentLiveState";
import { newSession } from "../../sessions/model/session";

it("renders the derived storage blocker and becomes queued after repair starts", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div"),
    root = createRoot(host);
  const session = {
    ...newSession("codex", "/app"),
    queuedMessages: [{ id: "q", text: "review", attachments: [] }],
    codexStorageError: "Storage repair needed: AGENTS.md",
  };
  try {
    await act(async () =>
      root.render(<AgentStatusLabel state={selectAgentLiveState(session)} />),
    );
    expect(host.textContent).toBe("Blocked · storage");
    expect(
      host.querySelector('[data-agent-state="blocked"]')?.getAttribute("title"),
    ).toBe("Blocked · storage · Storage repair needed: AGENTS.md");
    expect(host.textContent).not.toContain("Idle");
    await act(async () =>
      root.render(
        <AgentStatusLabel
          state={selectAgentLiveState({
            ...session,
            codexStorageError: undefined,
            codexStoragePreparing: true,
          })}
        />,
      ),
    );
    expect(host.textContent).toBe("Queued · waiting for storage");
    await act(async () =>
      root.render(
        <AgentStatusLabel
          state={{
            status: "waiting-review",
            waitingOn: "Reviewer",
            detail: "Reviewing task t",
          }}
        />,
      ),
    );
    expect(host.textContent).toBe("Waiting on Reviewer");
    expect(host.querySelector("span")?.title).toBe(
      "Waiting on Reviewer · Reviewing task t",
    );
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});

it.each<AgentLiveStatus>([
  "thinking",
  "running-tool",
  "compacting",
  "waiting-review",
  "waiting-on-member",
  "queued",
  "blocked",
  "needs-you",
  "idle",
  "done",
  "failed",
])("keeps %s readable with one decorative state cue", async (status) => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div"),
    root = createRoot(host);
  try {
    await act(async () => root.render(<AgentStatusLabel state={{ status }} />));
    expect(host.textContent).toBe(agentLiveStateLabel({ status }));
    expect(
      host.querySelectorAll('.agent-state-cue[aria-hidden="true"]'),
    ).toHaveLength(1);
    expect(host.querySelector("svg") !== null).toBe(status === "done");
    expect(host.querySelector("button, [tabindex]")).toBeNull();
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});
