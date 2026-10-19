// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Mono, MonoState } from "../../features/monos/model/mono";
import { monoLiveState } from "../../features/monos/model/monoNavigation";
import type { OrchestrationRun } from "../../features/orchestration/model/orchestrationState";
import { WorkspaceTeam, workspaceTeam } from "./WorkspaceTeam";

const mono = (id: string, extra: Partial<Mono> = {}): Mono => ({
  id,
  name: id,
  mascot: "cat",
  color: "#60a5fa",
  projects: ["C:/repo"],
  ...extra,
});
const roster = [
  mono("Boss", { role: "orchestrator", projects: [] }),
  mono("Manager", { role: "manager" }),
  mono("Atlas", { role: "member", reportsTo: "Manager" }),
  mono("Other", { role: "member", reportsTo: "Elsewhere" }),
  mono("Archived", { role: "member", reportsTo: "Manager", archivedAt: 1 }),
  mono("Solo"),
];
let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

it("pins the Boss and scopes active members to the dedicated Manager across Windows path spellings", () => {
  expect(workspaceTeam(roster, "c:\\REPO")).toEqual({
    bosses: [roster[0]],
    manager: roster[1],
    members: [roster[2]],
  });
  expect(workspaceTeam(roster, "C:/other")).toEqual({
    bosses: [roster[0]],
    manager: undefined,
    members: [],
  });
});

it("routes each team row to its real Mono, preserves standalone access and canonical blocked detail without showing commands", () => {
  const open = vi.fn(),
    create = vi.fn();
  act(() =>
    root.render(
      createElement(WorkspaceTeam, {
        roster,
        project: "C:/repo",
        activeId: "Atlas",
        states: new Map<string, MonoState>([
          [
            "Atlas",
            {
              status: "needs-you",
              liveState: {
                status: "blocked",
                reason: "storage",
                detail: "Repair storage first",
              },
              activity: "C:/private/tool.exe",
            },
          ],
        ]),
        onOpen: open,
        onCreate: create,
        onDelete: vi.fn(),
      }),
    ),
  );
  const row = host.querySelector<HTMLButtonElement>(
    '[data-workspace-mono="Atlas"]',
  )!;
  expect(row.getAttribute("aria-current")).toBe("page");
  expect(row.textContent).toContain("Blocked · storage");
  expect(row.title).toContain("Repair storage first");
  expect(host.textContent).not.toContain("private");
  expect(host.querySelectorAll("[data-workspace-mono]")).toHaveLength(4);
  act(() => row.click());
  expect(open).toHaveBeenCalledExactlyOnceWith("Atlas");
  act(() =>
    host.querySelector<HTMLButtonElement>('[aria-label="New mono"]')!.click(),
  );
  expect(create).toHaveBeenCalledExactlyOnceWith(["C:/repo"]);
});

it("shows honest unassigned project states without losing the pinned Boss", () => {
  act(() =>
    root.render(
      createElement(WorkspaceTeam, {
        roster,
        project: "C:/empty",
        states: new Map(),
        onOpen: vi.fn(),
        onCreate: vi.fn(),
        onDelete: vi.fn(),
      }),
    ),
  );
  expect(host.textContent).toContain("No Manager assigned");
  expect(host.querySelector('[data-workspace-mono="Boss"]')).not.toBeNull();
  expect(host.querySelector('[data-workspace-mono="Atlas"]')).toBeNull();
});

it("carries the owning run's pause reason through the canonical state into its member row", () => {
  const run = {
    version: 2, leadId: "manager-run", ownerMonoId: "Manager", cwd: "C:/repo",
    status: "paused", lastPauseReason: "Owner explicitly paused for review",
    allowedHarnesses: ["codex"], maxWorkers: 1, cli: "fixture", continuations: 0, requests: {}, dispatches: [],
    tasks: [{ id: "queued", memberId: "Atlas", title: "Review", status: "queued", dependsOn: [] }],
  } as unknown as OrchestrationRun;
  act(() => root.render(createElement(WorkspaceTeam, {
    roster, project: "C:/repo",
    states: new Map([["Atlas", monoLiveState(roster, [run], [], "Atlas")]]),
    onOpen: vi.fn(), onCreate: vi.fn(), onDelete: vi.fn(),
  })));
  const row = host.querySelector<HTMLButtonElement>('[data-workspace-mono="Atlas"]')!;
  expect(row.textContent).toContain("Queued");
  expect(row.title).toContain("Owner explicitly paused for review");
  expect(row.title).not.toContain("Waiting for an available worker");
});
