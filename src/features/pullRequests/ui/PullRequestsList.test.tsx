// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { PullRequestsList } from "./PullRequestsList";
import {
  recordPullRequest,
  pullRequests,
  markPullRequestUnavailable,
  type WorktreePr,
} from "../../source-control/model/pullRequests";
import type { GithubPrChecksView } from "../../inbox/hooks/useGithubPrChecks";
import { OPEN_PULL_REQUESTS } from "../model/pullRequestView";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
vi.mock("../../inbox/model/githubTasks", () => ({
  formatRelativeTime: () => "2h ago",
}));
const checks = vi.hoisted(() => ({
  view: {
    checks: null,
    loading: false,
    refreshing: false,
    error: null,
    stale: false,
    refresh: () => {},
  } as GithubPrChecksView,
}));
vi.mock("../../inbox/hooks/useGithubPrChecks", () => ({
  useGithubPrChecks: () => checks.view,
}));
const now = Date.parse("2026-10-08T12:00:00Z");
function fixture(
  number: number,
  pr: Partial<WorktreePr["pr"]> = {},
): WorktreePr {
  return {
    cwd: "/project",
    verifiedAt: now,
    links: [],
    pr: {
      number,
      title: `Fix ${number}`,
      url: `https://github.com/o/repo/pull/${number}`,
      state: "open",
      checksStatus: "pending",
      baseRefName: "main",
      headRefName: "fix",
      additions: 12,
      deletions: 3,
      updatedAt: new Date(now).toISOString(),
      mergeable: "UNKNOWN",
      ...pr,
    },
  };
}

it("renders compact metadata and latest states, hides noise and history by default, and opens detail", async () => {
  const host = document.createElement("div"),
    root = createRoot(host),
    onOpen = vi.fn();
  const entries = [
    fixture(1),
    fixture(2, {
      state: "merged",
      closedAt: new Date(now - 1000).toISOString(),
    }),
    fixture(3, { state: "closed" }),
  ];
  try {
    await act(async () =>
      root.render(
        <PullRequestsList entries={entries} now={now} onOpen={onOpen} />,
      ),
    );
    expect(host.querySelectorAll("[data-pr-row]")).toHaveLength(1);
    const row = host.querySelector<HTMLButtonElement>("[data-pr-row]")!;
    for (const text of [
      "Fix 1",
      "main ← fix",
      "+12",
      "−3",
      "Checks running",
      "you",
      "project",
      "2h ago",
    ])
      expect(row.textContent).toContain(text);
    expect(host.textContent).not.toContain("unknown");
    expect(host.textContent).not.toContain("No review decision");
    await act(async () => row.click());
    expect(onOpen).toHaveBeenCalledWith(entries[0]);
    await act(async () =>
      host.querySelector<HTMLButtonElement>("[aria-expanded]")!.click(),
    );
    expect(host.querySelectorAll("[data-pr-row]")).toHaveLength(2);
    const closed = host.querySelector<HTMLInputElement>(
      'input[type="checkbox"]',
    )!;
    await act(async () => closed.click());
    expect(host.querySelectorAll("[data-pr-row]")).toHaveLength(3);
  } finally {
    await act(async () => root.unmount());
  }
});

it("explains empty, loading and failed scoped lists and keeps saved content during refresh failures", async () => {
  const host = document.createElement("div"), root = createRoot(host);
  const onRetry = vi.fn(), onOpenAll = vi.fn();
  const scope = { cwd: "/project" };
  window.addEventListener(OPEN_PULL_REQUESTS, onOpenAll);
  try {
    await act(async () => root.render(<PullRequestsList compact entries={[]} scope={scope} />));
    expect(host.textContent).toContain("No related pull requests yet.");
    expect(host.querySelectorAll("section")).toHaveLength(0);
    await act(async () => [...host.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "Open all PRs")!.click());
    expect(onOpenAll).toHaveBeenCalledOnce();
    expect((onOpenAll.mock.calls[0][0] as CustomEvent).detail).toEqual({});
    await act(async () => root.render(<PullRequestsList compact entries={[]} scope={scope} loading />));
    expect(host.querySelector('[role="status"]')?.textContent).toBe("Loading related pull requests…");
    expect(host.textContent).not.toContain("No related pull requests");
    await act(async () => root.render(<PullRequestsList compact entries={[]} scope={scope} error="Offline" onRetry={onRetry} />));
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("Could not load related pull requests. Offline");
    await act(async () => [...host.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "Retry pull requests")!.click());
    expect(onRetry).toHaveBeenCalledOnce();
    const entries = [fixture(1)];
    await act(async () => root.render(<PullRequestsList compact entries={entries} scope={scope} loading />));
    expect(host.querySelector('[role="status"]')?.textContent).toBe("Refreshing related pull requests…");
    expect(host.querySelectorAll("[data-pr-row]")).toHaveLength(1);
    await act(async () => root.render(<PullRequestsList compact entries={entries} scope={scope} error="Offline" />));
    expect(host.textContent).toContain("Showing saved pull requests.");
    expect(host.querySelectorAll("[data-pr-row]")).toHaveLength(1);
    await act(async () => root.render(<PullRequestsList compact entries={[{ ...fixture(1), unavailable: true }]} scope={scope} />));
    expect(host.querySelector('[role="status"]')?.textContent).toBe("Latest PR status is unavailable. Showing saved pull requests.");
    expect(host.querySelectorAll("[data-pr-row]")).toHaveLength(1);
  } finally { await act(async () => root.unmount()); window.removeEventListener(OPEN_PULL_REQUESTS, onOpenAll); }
});

it("explains filter-empty results and resets filters including hidden closed PRs", async () => {
  const host = document.createElement("div"), root = createRoot(host);
  const entries = [fixture(1), fixture(2, { state: "closed" })];
  try {
    await act(async () => root.render(<PullRequestsList compact entries={entries} now={now} />));
    const ownership = host.querySelector<HTMLSelectElement>('[aria-label="PR ownership"]')!;
    await act(async () => {
      ownership.value = "team";
      ownership.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(host.textContent).toContain("No pull requests match these filters.");
    expect(host.querySelectorAll("section")).toHaveLength(0);
    await act(async () => [...host.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "Reset filters")!.click());
    expect(host.querySelectorAll("[data-pr-row]")).toHaveLength(2);
    expect(host.textContent).not.toContain("No pull requests match");
  } finally { await act(async () => root.unmount()); }
});

it("does not offer a filter reset that cannot reveal old unreferenced merged history", async () => {
  const host = document.createElement("div"), root = createRoot(host);
  try {
    await act(async () => root.render(<PullRequestsList entries={[fixture(1, { state: "merged", closedAt: "2020-01-01T00:00:00Z" })]} now={now} />));
    expect(host.textContent).toContain("No recent pull requests in this context.");
    expect(host.textContent).not.toContain("Reset filters");
  } finally { await act(async () => root.unmount()); }
});

it("shows the existing PR checks loader and its retryable errors without erasing rows", async () => {
  const entry = fixture(91, { headOid: "checks-head" });
  recordPullRequest(entry.cwd, entry.pr);
  const host = document.createElement("div"), root = createRoot(host);
  const original = checks.view;
  const refresh = vi.fn();
  try {
    checks.view = { ...original, loading: true, refresh };
    await act(async () => root.render(<PullRequestsList scope={{ urls: [entry.pr.url] }} now={now} />));
    expect(host.querySelector('[role="status"]')?.textContent).toContain("Loading checks for PR #91");
    checks.view = { ...original, refreshing: true, refresh };
    await act(async () => root.render(<PullRequestsList scope={{ urls: [entry.pr.url] }} now={now} />));
    expect(host.querySelector('[role="status"]')?.textContent).toContain("Refreshing checks for PR #91");
    checks.view = { ...original, error: "Checks offline", refresh };
    await act(async () => root.render(<PullRequestsList scope={{ urls: [entry.pr.url] }} now={now} />));
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("Checks for PR #91 are unavailable. Checks offline");
    expect(host.querySelectorAll("[data-pr-row]")).toHaveLength(1);
    await act(async () => [...host.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "Retry checks for PR #91")!.click());
    expect(refresh).toHaveBeenCalledOnce();
  } finally { await act(async () => root.unmount()); checks.view = original; }
});

it("filters search and project and supports keyboard navigation", async () => {
  const host = document.createElement("div"),
    root = createRoot(host);
  document.body.append(host);
  const entries = [
    fixture(1),
    fixture(2),
    { ...fixture(3), cwd: "/other-project" },
  ];
  try {
    await act(async () =>
      root.render(<PullRequestsList entries={entries} now={now} />),
    );
    const buttons = Array.from(
      host.querySelectorAll<HTMLButtonElement>("[data-pr-row]"),
    );
    buttons[0].focus();
    await act(async () =>
      buttons[0].dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
      ),
    );
    expect(document.activeElement).toBe(buttons[1]);
    await act(async () =>
      buttons[1].dispatchEvent(
        new KeyboardEvent("keydown", { key: "End", bubbles: true }),
      ),
    );
    expect(document.activeElement).toBe(buttons[2]);
    const project = host.querySelector<HTMLSelectElement>(
      'select[aria-label="Project"]',
    )!;
    await act(async () => {
      project.value = "/project";
      project.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(host.querySelectorAll("[data-pr-row]")).toHaveLength(2);
    const search = host.querySelector<HTMLInputElement>(
      'input[aria-label="Search pull requests"]',
    )!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!;
      setter.call(search, "Fix 1");
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(host.querySelectorAll("[data-pr-row]")).toHaveLength(1);
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it("shows explicitly referenced old merged and closed PRs", async () => {
  const host = document.createElement("div"),
    root = createRoot(host);
  const entries = [
    fixture(1, { state: "merged", closedAt: "2020-01-01T00:00:00Z" }),
    fixture(2, { state: "closed" }),
  ];
  try {
    await act(async () =>
      root.render(
        <PullRequestsList
          entries={entries}
          scope={{ urls: entries.map((entry) => entry.pr.url) }}
          now={now}
        />,
      ),
    );
    expect(host.querySelectorAll("[data-pr-row]")).toHaveLength(2);
  } finally {
    await act(async () => root.unmount());
  }
});

it("shares latest exact-head check results with R19 and does not revive unavailable status", async () => {
  const entry = fixture(90, {
    checksStatus: "failure",
    headOid: "same-head",
    mergeable: "MERGEABLE",
    mergeStateStatus: "CLEAN",
  });
  recordPullRequest(entry.cwd, entry.pr);
  checks.view = {
    ...checks.view,
    checks: {
      headOid: "same-head",
      checks: [
        {
          name: "Tests",
          workflow: "CI",
          state: "fail",
          startedAt: "2026-10-07T01:00:00Z",
          completedAt: "2026-10-07T01:01:00Z",
          url: "https://github.com/o/repo/actions/runs/1/job/1",
        },
        {
          name: "Tests",
          workflow: "CI",
          state: "pass",
          startedAt: "2026-10-08T01:00:00Z",
          completedAt: "2026-10-08T01:01:00Z",
          url: "https://github.com/o/repo/actions/runs/2/job/2",
        },
      ],
    },
  };
  const host = document.createElement("div"),
    root = createRoot(host);
  try {
    await act(async () =>
      root.render(
        <PullRequestsList now={now} scope={{ urls: [entry.pr.url] }} />,
      ),
    );
    expect(
      pullRequests().find((record) => record.pr.number === 90)?.pr.checksStatus,
    ).toBe("success");
    expect(
      host.querySelector("[data-pr-row]")?.getAttribute("aria-label"),
    ).toContain("Ready to merge");
    await act(async () => {
      recordPullRequest(entry.cwd, { ...entry.pr, checksStatus: "failure" });
      markPullRequestUnavailable(entry.cwd, entry.pr.url);
    });
    expect(
      pullRequests().find((record) => record.pr.number === 90)?.unavailable,
    ).toBe(true);
    expect(
      host.querySelector("[data-pr-row]")?.getAttribute("aria-label"),
    ).toContain("Status unavailable");
  } finally {
    await act(async () => root.unmount());
    checks.view = { ...checks.view, checks: null };
  }
});
