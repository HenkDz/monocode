// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import type { WorktreePr } from "../../source-control/model/pullRequests";
import { PullRequestsView, pullRequestInboxItem } from "./PullRequestsView";

const state = vi.hoisted(() => ({
  entries: [] as WorktreePr[],
  detail: vi.fn(),
  actions: vi.fn(),
}));
vi.mock("../../source-control/model/pullRequests", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../source-control/model/pullRequests")
  >()),
  usePullRequests: () => state.entries,
}));
vi.mock("../../inbox/ui/InboxView", () => ({
  InboxDetail: (props: { prActions: React.ReactNode }) => {
    state.detail(props);
    return <div data-detail>{props.prActions}</div>;
  },
}));
vi.mock("../../source-control/ui/WorktreePrActions", () => ({
  WorktreePrActions: (props: unknown) => {
    state.actions(props);
    return <span>Confirmed PR controls</span>;
  },
}));
vi.mock("./PullRequestsList", () => ({
  PullRequestsList: () => <span>PR list</span>,
}));
vi.mock("../../../app/shell/TitleBar", () => ({
  OverlayNav: () => <span>Overlay navigation</span>,
}));
vi.mock("../../../app/shell/WindowControls", () => ({
  WindowControls: () => <span>Window controls</span>,
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const fixture = (): WorktreePr => ({
  cwd: "/repo",
  verifiedAt: 1000,
  links: [],
  pr: {
    number: 1,
    title: "Fixed",
    url: "https://github.com/o/repo/pull/1",
    state: "merged",
    closedAt: "2026-10-08T00:00:00Z",
  },
});

it("opens the reused Inbox detail with the freshest snapshot and confirmed R19 controls", async () => {
  const older = fixture(),
    newest = {
      ...fixture(),
      verifiedAt: 2000,
      pr: { ...fixture().pr, title: "Newest" },
    };
  state.entries = [older, newest];
  const host = document.createElement("div"),
    root = createRoot(host);
  try {
    await act(async () =>
      root.render(<PullRequestsView scope={{ urls: [older.pr.url] }} />),
    );
    expect(
      state.detail.mock.calls[state.detail.mock.calls.length - 1]?.[0],
    ).toMatchObject({
      item: { title: "Newest", state: "merged", repo: "o/repo" },
      revision: 2000,
    });
    expect(
      state.actions.mock.calls[state.actions.mock.calls.length - 1]?.[0],
    ).toMatchObject({
      entry: { pr: { title: "Newest" } },
    });
    expect(host.textContent).toContain("Confirmed PR controls");
    await act(async () =>
      host
        .querySelector<HTMLButtonElement>(
          'button[aria-label="Back to pull requests"]',
        )!
        .click(),
    );
    expect(host.textContent).toContain("PR list");
    expect(host.querySelector("[data-detail]")).toBeNull();
  } finally {
    await act(async () => root.unmount());
  }
});

it("converts merged status without dropping the enterprise hostname", () => {
  const entry = fixture();
  entry.pr.url = "https://enterprise.example/o/repo/pull/1";
  expect(pullRequestInboxItem(entry)).toMatchObject({
    repo: "enterprise.example/o/repo",
    state: "merged",
    projectPath: "/repo",
  });
});
