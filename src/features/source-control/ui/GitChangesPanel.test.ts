// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(async () => {}),
}));

const { invalidateWatchedFiles } = vi.hoisted(() => ({
  invalidateWatchedFiles: vi.fn(),
}));

vi.mock("../../../platform/tauri/fs", () => ({
  gitDiffIndex: vi.fn(),
  gitHistory: vi.fn(async () => []),
  gitPrStatus: vi.fn(async () => null),
  gitPrList: vi.fn(async () => []),
  gitPrStatusByUrl: vi.fn(async () => null),
  gitPull: vi.fn(async () => {}),
  gitFetch: vi.fn(async () => {}),
  gitPush: vi.fn(async () => {}),
  gitSync: vi.fn(async () => {}),
  gitCommit: vi.fn(async () => {}),
  gitHeadMessage: vi.fn(async () => ""),
  gitStageAll: vi.fn(async () => {}),
  gitUnstageAll: vi.fn(async () => {}),
  gitDiscardAll: vi.fn(async () => {}),
  gitStageFile: vi.fn(async () => {}),
  gitUnstageFile: vi.fn(async () => {}),
  gitDiscardFile: vi.fn(async () => {}),
  gitPrCreate: vi.fn(async () => ""),
  gitRangeContext: vi.fn(),
  notifyGitChanged: vi.fn(),
  subscribeGitChanged: () => () => {},
  basename: (path: string) => path.split("/").pop() ?? path,
}));

vi.mock("../../../integrations/harness", () => ({
  generateCommitMessage: vi.fn(async () => ""),
  generatePrContent: vi.fn(async () => null),
}));

vi.mock("../../files/model/fileWatch", () => ({
  invalidateWatchedFiles,
  nudgeWatchedFiles: vi.fn(),
}));

vi.mock("../../inbox/model/inboxSelfActivity", () => ({
  recordInboxSelfActivity: vi.fn(),
}));

import { GitChangesPanel } from "./GitChangesPanel";
import {
  gitDiffIndex,
  gitFetch,
  gitPrCreate,
  gitPull,
  gitPush,
  gitSync,
  gitRangeContext,
  gitStageFile,
  gitUnstageFile,
  notifyGitChanged,
} from "../../../platform/tauri/fs";
import {
  generateCommitMessage,
  generatePrContent,
} from "../../../integrations/harness";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { GitChangedFile, GitDiffIndex } from "../../../platform/tauri/fs";

function index(overrides: Partial<GitDiffIndex> = {}): GitDiffIndex {
  return {
    branch: "feature/pull",
    head: "abc123",
    files: [],
    additions: 0,
    deletions: 0,
    remote: null,
    upstream: null,
    remoteBranch: null,
    defaultBranch: "main",
    ahead: 0,
    behind: 0,
    aheadOfDefault: 0,
    headPushed: true,
    ...overrides,
  };
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  // Keep delayed file invalidations from reaching the next test's mocks.
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.mocked(gitDiffIndex).mockReset();
  vi.mocked(gitPull).mockReset();
  vi.mocked(gitFetch).mockReset().mockResolvedValue(undefined);
  vi.mocked(gitSync).mockClear();
  vi.mocked(gitPush).mockClear();
  vi.mocked(gitStageFile).mockReset().mockResolvedValue(undefined);
  vi.mocked(gitUnstageFile).mockReset().mockResolvedValue(undefined);
  vi.mocked(notifyGitChanged).mockClear();
  vi.mocked(generateCommitMessage).mockReset();
  invalidateWatchedFiles.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

describe("GitChangesPanel commit message generation", () => {
  it("cancels promptly and ignores a late result after a retry", async () => {
    vi.mocked(gitDiffIndex).mockResolvedValue(
      index({
        files: [
          {
            path: "/repo/change.ts",
            relative: "change.ts",
            status: "modified",
            additions: 1,
            deletions: 0,
            staged: true,
            unstaged: false,
          },
        ],
      }),
    );
    let resolveFirst!: (message: string) => void;
    vi.mocked(generateCommitMessage)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockResolvedValueOnce("New message");
    await renderPanel();

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(
          '[aria-label="Generate commit message"]',
        )!
        .click();
    });
    const signal = vi.mocked(generateCommitMessage).mock.calls[0]?.[2];
    expect(signal?.aborted).toBe(false);

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(
          '[aria-label="Cancel commit message generation"]',
        )!
        .click();
    });
    expect(signal?.aborted).toBe(true);
    expect(
      container.querySelector<HTMLButtonElement>(
        '[aria-label="Generate commit message"]',
      )?.disabled,
    ).toBe(false);
    expect(container.querySelector("textarea")?.disabled).toBe(false);

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(
          '[aria-label="Generate commit message"]',
        )!
        .click();
    });
    expect(container.querySelector("textarea")?.value).toBe("New message");

    await act(async () => resolveFirst("Old message"));
    expect(container.querySelector("textarea")?.value).toBe("New message");
  });
});

afterEach(() => {
  act(() => root.unmount());
  vi.clearAllTimers();
  vi.useRealTimers();
  container.remove();
  document.body
    .querySelectorAll("[data-popover-side]")
    .forEach((element) => element.remove());
  vi.unstubAllGlobals();
});

async function renderPanel(cwd = "/repo") {
  act(() =>
    root.render(
      createElement(GitChangesPanel, {
        cwd,
        enabled: true,
        onOpenFile: vi.fn(),
        onOpenAllChanges: vi.fn(),
        onOpenCommit: vi.fn(),
      }),
    ),
  );
  await act(async () => {});
}

async function openBranchMenu() {
  const toggle = container.querySelector<HTMLButtonElement>(
    '[aria-label="Branch actions"]',
  )!;
  await act(async () => toggle.click());
  await act(async () => {});
  return document.querySelector<HTMLButtonElement>('[role="menuitem"]')!;
}

function changedFile(
  relative: string,
  overrides: Partial<GitChangedFile> = {},
): GitChangedFile {
  return {
    path: `/repo/${relative}`,
    relative,
    status: "modified",
    additions: 1,
    deletions: 0,
    staged: false,
    unstaged: true,
    ...overrides,
  };
}

async function showTree() {
  const toggle = container.querySelector<HTMLButtonElement>(
    '[aria-label="View as Tree"]',
  );
  if (toggle) await act(async () => toggle.click());
  let collapsed: HTMLButtonElement | null;
  while (
    (collapsed = container.querySelector<HTMLButtonElement>(
      'button[title][aria-expanded="false"]',
    ))
  ) {
    const folder = collapsed;
    await act(async () => folder.click());
  }
}

describe("GitChangesPanel folder actions", () => {
  it.each(["/repo", "remote://machine/home/user/repo"])(
    "stages a collapsed folder in one operation for %s",
    async (cwd) => {
      const files = [
        changedFile("src/app.ts", { path: `${cwd}/src/app.ts` }),
        changedFile("src/nested/new.ts", {
          path: `${cwd}/src/nested/new.ts`,
          status: "untracked",
        }),
        changedFile("src-other/other.ts"),
        changedFile("docs/ready.md", { staged: true, unstaged: false }),
      ];
      vi.mocked(gitDiffIndex).mockResolvedValue(index({ files }));
      await renderPanel(cwd);
      await showTree();
      const folder = container.querySelector<HTMLButtonElement>(
        'button[title="src"]',
      )!;
      await act(async () => folder.click());
      expect(folder.getAttribute("aria-expanded")).toBe("false");
      expect(container.querySelector('button[title="src/app.ts"]')).toBeNull();

      invalidateWatchedFiles.mockClear();
      vi.mocked(notifyGitChanged).mockClear();
      const reads = vi.mocked(gitDiffIndex).mock.calls.length;
      await act(async () => {
        container
          .querySelector<HTMLButtonElement>(
            '[aria-label="Stage Changes in src"]',
          )!
          .click();
      });

      expect(gitStageFile).toHaveBeenCalledExactlyOnceWith(cwd, "src");
      expect(gitUnstageFile).not.toHaveBeenCalled();
      expect(invalidateWatchedFiles).toHaveBeenCalledWith([
        `${cwd}/src/app.ts`,
        `${cwd}/src/nested/new.ts`,
      ]);
      expect(notifyGitChanged).toHaveBeenCalled();
      expect(vi.mocked(gitDiffIndex).mock.calls.length).toBeGreaterThan(reads);
      expect(folder.getAttribute("aria-expanded")).toBe("false");
    },
  );

  it("stages a nested folder without toggling it or including its siblings", async () => {
    vi.mocked(gitDiffIndex).mockResolvedValue(
      index({
        files: [
          changedFile("src/app.ts"),
          changedFile("src/nested/one.ts"),
          changedFile("src/nested/deeper/two.ts"),
          changedFile("src/nested-other/three.ts"),
        ],
      }),
    );
    await renderPanel();
    await showTree();
    const folder = container.querySelector<HTMLButtonElement>(
      'button[title="src/nested"]',
    )!;
    invalidateWatchedFiles.mockClear();
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(
          '[aria-label="Stage Changes in src/nested"]',
        )!
        .click();
    });

    expect(gitStageFile).toHaveBeenCalledExactlyOnceWith("/repo", "src/nested");
    expect(folder.getAttribute("aria-expanded")).toBe("true");
    expect(invalidateWatchedFiles).toHaveBeenCalledWith([
      "/repo/src/nested/one.ts",
      "/repo/src/nested/deeper/two.ts",
    ]);
  });

  it("unstages the staged folder including files that also have unstaged changes", async () => {
    vi.mocked(gitDiffIndex).mockResolvedValue(
      index({
        files: [
          changedFile("src/app.ts", { staged: true, unstaged: false }),
          changedFile("src/nested/partial.ts", { staged: true }),
          changedFile("docs/readme.md", { staged: true, unstaged: false }),
        ],
      }),
    );
    await renderPanel();
    await showTree();
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(
          '[aria-label="Unstage Changes in src"]',
        )!
        .click();
    });

    expect(gitUnstageFile).toHaveBeenCalledExactlyOnceWith("/repo", "src");
    expect(gitStageFile).not.toHaveBeenCalled();
  });

  it("disables folder and file mutations while a folder action is running", async () => {
    vi.mocked(gitDiffIndex).mockResolvedValue(
      index({
        files: [changedFile("src/app.ts"), changedFile("docs/readme.md")],
      }),
    );
    let finish!: () => void;
    vi.mocked(gitStageFile).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    await renderPanel();
    await showTree();
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(
          '[aria-label="Stage Changes in src"]',
        )!
        .click();
    });
    const actions = [
      ...container.querySelectorAll<HTMLButtonElement>(
        'button[aria-label^="Stage Changes"], button[aria-label="Discard Changes"]',
      ),
    ];
    expect(actions.length).toBeGreaterThan(2);
    expect(actions.every((action) => action.disabled)).toBe(true);
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(
          '[aria-label="Stage Changes in docs"]',
        )!
        .click();
    });
    expect(gitStageFile).toHaveBeenCalledTimes(1);

    await act(async () => finish());
    expect(actions.every((action) => !action.disabled)).toBe(true);
  });

  it("reports errors and enables folder actions again", async () => {
    const alert = vi.spyOn(window, "alert").mockImplementation(() => {});
    vi.mocked(gitDiffIndex).mockResolvedValue(
      index({ files: [changedFile("src/app.ts")] }),
    );
    vi.mocked(gitStageFile).mockRejectedValueOnce(
      new Error("Git index is locked"),
    );
    await renderPanel();
    await showTree();
    invalidateWatchedFiles.mockClear();
    const stage = container.querySelector<HTMLButtonElement>(
      '[aria-label="Stage Changes in src"]',
    )!;
    await act(async () => stage.click());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(150);
    });

    expect(alert).toHaveBeenCalledWith("Git index is locked");
    expect(stage.disabled).toBe(false);
    expect(invalidateWatchedFiles).not.toHaveBeenCalled();
    alert.mockRestore();
  });
});

describe("GitChangesPanel remote branch state", () => {
  it.each(["/repo", "remote://machine/home/user/repo"])(
    "fetches without an upstream and updates publication state for %s",
    async (cwd) => {
      vi.mocked(gitDiffIndex).mockResolvedValue(index({ remote: "origin" }));
      await renderPanel(cwd);
      expect(container.textContent).toContain("Publish Branch");
      const pull = await openBranchMenu();
      expect(pull.disabled).toBe(true);
      expect(container.textContent).toContain("not found on origin (cached)");
      expect(container.textContent).toContain("Upstream: not configured");
      const fetch = [
        ...container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
      ].find((button) => button.textContent === "Fetch")!;
      let finish!: () => void;
      vi.mocked(gitFetch).mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            finish = resolve;
          }),
      );
      await act(async () => fetch.click());
      expect(fetch.disabled).toBe(true);
      expect(
        container.querySelector<HTMLButtonElement>(
          '[aria-label="Branch actions"]',
        )!.disabled,
      ).toBe(true);
      expect(gitPull).not.toHaveBeenCalled();
      expect(gitPush).not.toHaveBeenCalled();
      expect(gitSync).not.toHaveBeenCalled();
      // Only remoteBranch changes: HEAD was already contained by origin/main.
      vi.mocked(gitDiffIndex).mockResolvedValue(
        index({ remote: "origin", remoteBranch: "origin/feature/pull" }),
      );
      const reads = vi.mocked(gitDiffIndex).mock.calls.length;
      await act(async () => finish());
      expect(gitFetch).toHaveBeenCalledExactlyOnceWith(cwd);
      expect(vi.mocked(gitDiffIndex).mock.calls.length).toBeGreaterThan(reads);
      expect(notifyGitChanged).toHaveBeenCalled();
      expect(container.textContent).toContain("Fetch complete");
      expect(container.textContent).toContain("Push & Set Upstream");
      expect(container.textContent).not.toContain("Publish Branch");
      await openBranchMenu();
      expect(container.textContent).toContain(
        "Remote branch: origin/feature/pull (cached)",
      );
      expect(container.textContent).toContain("Upstream: not configured");
      const publish = [
        ...container.querySelectorAll<HTMLButtonElement>("button"),
      ].find((button) => button.textContent === "Push & Set Upstream")!;
      await act(async () => publish.click());
      expect(gitSync).toHaveBeenCalledExactlyOnceWith(cwd);
    },
  );

  it("shows upstream separately and does not offer publication when tracking", async () => {
    vi.mocked(gitDiffIndex).mockResolvedValue(
      index({
        remote: "origin",
        remoteBranch: "origin/feature/pull",
        upstream: "origin/feature/pull",
      }),
    );
    await renderPanel();
    expect((await openBranchMenu()).disabled).toBe(false);
    expect(container.textContent).toContain("Upstream: origin/feature/pull");
    expect(container.textContent).not.toContain("Publish Branch");
    expect(container.textContent).not.toContain("Push & Set Upstream");
    await act(async () => {
      container
        .querySelector('[role="menu"]')!
        .dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
        );
    });
    expect(container.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(
      container.querySelector('[aria-label="Branch actions"]'),
    );
  });

  it("disables fetch without a remote and reports unknown state for older hosts", async () => {
    vi.mocked(gitDiffIndex).mockResolvedValue(index());
    await renderPanel();
    await openBranchMenu();
    expect(container.textContent).toContain("No remote configured");
    expect(
      [
        ...container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
      ].every((button) => button.disabled),
    ).toBe(true);
    vi.mocked(gitDiffIndex).mockResolvedValue(
      index({ remote: "origin", remoteBranch: undefined }),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(container.textContent).toContain(
      "Remote branch: unknown (update host)",
    );
  });

  it("reports fetch failures and releases the shared busy state", async () => {
    const alert = vi.spyOn(window, "alert").mockImplementation(() => {});
    vi.mocked(gitDiffIndex).mockResolvedValue(index({ remote: "origin" }));
    vi.mocked(gitFetch).mockRejectedValueOnce(
      new Error("Authentication failed"),
    );
    await renderPanel();
    await openBranchMenu();
    const fetch = [
      ...container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
    ].find((button) => button.textContent === "Fetch")!;
    vi.mocked(notifyGitChanged).mockClear();
    await act(async () => fetch.click());
    expect(alert).toHaveBeenCalledWith("Authentication failed");
    expect(container.textContent).not.toContain("Fetch complete");
    expect(notifyGitChanged).not.toHaveBeenCalled();
    expect(
      container.querySelector<HTMLButtonElement>(
        '[aria-label="Branch actions"]',
      )!.disabled,
    ).toBe(false);
    alert.mockRestore();
  });
});

describe("GitChangesPanel pull action", () => {
  it("disables Pull when the branch has no upstream", async () => {
    vi.mocked(gitDiffIndex).mockResolvedValue(
      index({ remote: "origin", upstream: null }),
    );
    await renderPanel();

    const pull = await openBranchMenu();
    expect(pull.textContent).toContain("Pull");
    expect(pull.disabled).toBe(true);
  });

  it("disables Pull when the repository has no remote", async () => {
    vi.mocked(gitDiffIndex).mockResolvedValue(
      index({ remote: null, upstream: "origin/feature/pull" }),
    );
    await renderPanel();

    const pull = await openBranchMenu();
    expect(pull.disabled).toBe(true);
  });

  it("pulls the current branch and reloads watched files", async () => {
    vi.mocked(gitDiffIndex).mockResolvedValue(
      index({ remote: "origin", upstream: "origin/feature/pull" }),
    );
    await renderPanel();

    const pull = await openBranchMenu();
    expect(pull.disabled).toBe(false);

    invalidateWatchedFiles.mockClear();
    await act(async () => {
      pull.click();
      await Promise.resolve();
    });

    expect(gitPull).toHaveBeenCalledWith("/repo");
    expect(invalidateWatchedFiles).toHaveBeenCalled();
  });
});

describe("GitChangesPanel remote pull request", () => {
  it("creates it from the host Git range without calling a local harness", async () => {
    const cwd = "remote://machine/home/user/repo";
    vi.mocked(gitDiffIndex).mockResolvedValue(
      index({
        remote: "origin",
        upstream: "origin/feature/pull",
        ahead: 1,
        aheadOfDefault: 1,
      }),
    );
    vi.mocked(gitRangeContext).mockResolvedValue({
      base: "main",
      head: "feature/pull",
      commitSummary: "abc123 Fix remote flow\ndef456 Add coverage",
      diffSummary: "2 files changed, 4 insertions(+)\n",
      diffPatch: "",
    });
    vi.mocked(gitPrCreate).mockResolvedValue("https://example.test/pull/42");
    await renderPanel(cwd);

    const button = [
      ...container.querySelectorAll<HTMLButtonElement>("button"),
    ].find((candidate) => candidate.textContent?.trim() === "Create PR");
    expect(button?.disabled).toBe(false);
    await act(async () => {
      button!.click();
      await Promise.resolve();
    });

    expect(gitPush).toHaveBeenCalledWith(cwd);
    expect(gitRangeContext).toHaveBeenCalledWith(cwd);
    expect(generatePrContent).not.toHaveBeenCalled();
    expect(gitPrCreate).toHaveBeenCalledWith(
      cwd,
      "Fix remote flow",
      expect.stringContaining("## Changes\n\n2 files changed"),
      "main",
      "feature/pull",
    );
    expect(openUrl).toHaveBeenCalledWith("https://example.test/pull/42");
  });
});
