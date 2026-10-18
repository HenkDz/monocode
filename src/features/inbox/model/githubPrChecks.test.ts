import { afterEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import {
  checkDuration,
  countChecks,
  describeCheckCounts,
  fetchGithubPrChecks,
  isHttpUrl,
  sortChecks,
  summarizePrChecks,
  latestPrChecks,
  groupPrChecks,
  type GithubPrCheck,
} from "./githubPrChecks";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const invokeMock = vi.mocked(invoke);

afterEach(() => {
  invokeMock.mockReset();
});

function check(overrides: Partial<GithubPrCheck> = {}): GithubPrCheck {
  return {
    name: "ci/build",
    workflow: "Build",
    state: "pass",
    url: null,
    startedAt: null,
    completedAt: null,
    ...overrides,
  };
}

describe("fetchGithubPrChecks", () => {
  it("calls git_github_pr_checks with cwd, repo and number", async () => {
    const answer = {
      headOid: "abc123",
      checks: [check()],
    };
    invokeMock.mockResolvedValue(answer);
    await expect(
      fetchGithubPrChecks("/tmp/web", "acme/web", 7),
    ).resolves.toBe(answer);
    expect(invokeMock).toHaveBeenCalledWith("git_github_pr_checks", {
      cwd: "/tmp/web",
      repo: "acme/web",
      number: 7,
    });
  });
});

describe("sortChecks", () => {
  it("groups fail, pending, cancel, unknown, pass, skipping and stays stable inside a group", () => {
    const sorted = sortChecks([
      check({ name: "skip-1", state: "skipping" }),
      check({ name: "pass-1", state: "pass" }),
      check({ name: "fail-1", state: "fail" }),
      check({ name: "pass-2", state: "pass" }),
      check({ name: "pending-1", state: "pending" }),
      check({ name: "fail-2", state: "fail" }),
      check({ name: "cancel-1", state: "cancel" }),
      check({ name: "unknown-1", state: "unknown" }),
    ]);
    expect(sorted.map((entry) => entry.name)).toEqual([
      "fail-1",
      "fail-2",
      "pending-1",
      "cancel-1",
      "unknown-1",
      "pass-1",
      "pass-2",
      "skip-1",
    ]);
  });
});

describe("latest attempts", () => {
  it("orders suites before attempts and timestamps; retains quiet history", () => {
    const failed = check({ state: "fail", suiteId: 1, runAttempt: 4, startedAt: "2026-10-08T14:00:00Z" });
    const passed = check({ suiteId: 2, runAttempt: 1, startedAt: "2026-10-08T13:00:00Z" });
    const pending = check({ state: "pending", suiteId: 2, runAttempt: 2 });
    for (const checks of [[failed, passed, pending], [pending, passed, failed]]) {
      expect(latestPrChecks(checks).map(check => check.state)).toEqual(["pending"]);
      expect(groupPrChecks(checks)[0].earlier.map(check => check.state)).toEqual(["pass", "fail"]);
      expect(countChecks(checks).fail).toBe(0);
      expect(summarizePrChecks({ checks, error: null, loading: false }).kind).toBe("pending");
    }
  });

  it("groups reruns by workflow/app/context and keeps matrix jobs distinct", () => {
    const failed = check({ name: "build (ubuntu)", state: "fail", completedAt: "2026-10-08T13:00:00Z" });
    const passed = { ...failed, state: "pass" as const, completedAt: "2026-10-08T14:00:00Z" };
    const checks = [failed, passed, { ...passed, name: "build (windows)" }, { ...failed, workflow: "Other" }, { ...failed, app: "other" }, { ...failed, context: "arm" }, { ...failed, kind: "StatusContext" }];
    expect(latestPrChecks(checks)).toHaveLength(6);
    expect(countChecks(checks).fail).toBe(4);
  });

  it("uses GitHub Actions suite order, preserves unknown chronology blockers and counts steps independently", () => {
    const checks = [check({ state: "fail", url: "https://github.com/acme/web/actions/runs/1/job/10" }), check({ url: "https://github.com/acme/web/actions/runs/2/job/20" })];
    expect(countChecks(checks).fail).toBe(0);
    expect(countChecks([check({ state: "fail" }), check()]).fail).toBe(1);
    expect(countChecks([{ state: "pass" }, { state: "pass" }]).pass).toBe(2);
  });

  it("merged/closed PRs have a neutral summary even with historic failures", () => {
    for (const state of ["merged", "closed"]) expect(summarizePrChecks({ checks: [check({ state: "fail" })], error: null, loading: false, state })).toEqual({ kind: "neutral", description: `PR ${state}` });
  });
});

describe("describeCheckCounts", () => {
  it("names every non-zero state so color is not the only signal", () => {
    expect(
      describeCheckCounts(
        countChecks([
          check({ name: "pass1", state: "pass" }),
          check({ name: "pass2", state: "pass" }),
          check({ name: "fail", state: "fail" }),
          check({ name: "pending", state: "pending" }),
          check({ name: "cancel", state: "cancel" }),
          check({ name: "unknown", state: "unknown" }),
          check({ name: "skip", state: "skipping" }),
        ]),
      ),
    ).toBe("1 failed, 1 in progress, 1 cancelled, 1 unknown, 2 passed, 1 skipped");
    expect(describeCheckCounts(countChecks([]))).toBeNull();
  });
});

describe("summarizePrChecks", () => {
  it("keeps initial loading distinct from an empty result", () => {
    expect(
      summarizePrChecks({ loading: true, error: null, checks: null }).kind,
    ).toBe("loading");
    const empty = summarizePrChecks({
      loading: false,
      error: null,
      checks: [],
    });
    expect(empty.kind).toBe("neutral");
    expect(empty.description).toBe("No checks reported");
  });

  it("ranks load error, fail, pending and cancel/unknown above success", () => {
    const loading = {
      loading: false,
      error: null as string | null,
    };
    expect(
      summarizePrChecks({
        ...loading,
        error: "offline",
        checks: [check({ state: "fail" })],
      }).kind,
    ).toBe("error");
    expect(
      summarizePrChecks({
        ...loading,
        checks: [check({ state: "fail" }), check({ state: "pending" })],
      }).kind,
    ).toBe("fail");
    expect(
      summarizePrChecks({
        ...loading,
        checks: [check({ name: "pending", state: "pending" }), check({ name: "cancel", state: "cancel" })],
      }).kind,
    ).toBe("pending");
    expect(
      summarizePrChecks({
        ...loading,
        checks: [check({ state: "cancel" }), check({ state: "unknown" })],
      }).kind,
    ).toBe("neutral");
    expect(
      summarizePrChecks({
        ...loading,
        checks: [check({ state: "pass" }), check({ state: "skipping" })],
      }).kind,
    ).toBe("pass");
  });

  it("carries the fail count on the fail summary", () => {
    const summary = summarizePrChecks({
      loading: false,
      error: null,
      checks: [check({ name: "fail1", state: "fail" }), check({ name: "fail2", state: "fail" }), check()],
    });
    expect(summary).toMatchObject({ kind: "fail", failed: 2 });
    expect(summary.description).toBe("2 failed, 1 passed");
  });

  it("stays neutral for a skipping-only list while still saying the count", () => {
    const summary = summarizePrChecks({
      loading: false,
      error: null,
      checks: [check({ name: "skip1", state: "skipping" }), check({ name: "skip2", state: "skipping" })],
    });
    expect(summary.kind).toBe("neutral");
    expect(summary.description).toBe("2 skipped");
  });

  it("describes saved results when a refresh fails on top of them", () => {
    const summary = summarizePrChecks({
      loading: false,
      error: "boom",
      checks: [check({ state: "pass" })],
    });
    expect(summary.kind).toBe("error");
    expect(summary.description).toBe(
      "Checks failed to load, showing saved results that may be out of date: 1 passed",
    );
    expect(
      summarizePrChecks({ loading: false, error: "boom", checks: null })
        .description,
    ).toBe("Checks failed to load");
  });
});

describe("checkDuration", () => {
  it("formats only valid, non-negative spans", () => {
    expect(
      checkDuration(
        "2030-01-01T10:00:00Z",
        "2030-01-01T10:00:42Z",
      ),
    ).toBe("42s");
    expect(
      checkDuration(
        "2030-01-01T10:00:00Z",
        "2030-01-01T10:05:05Z",
      ),
    ).toBe("5m 05s");
    expect(
      checkDuration(
        "2030-01-01T10:00:00Z",
        "2030-01-01T12:03:00Z",
      ),
    ).toBe("2h 03m");
    expect(checkDuration(null, "2030-01-01T10:00:42Z")).toBeNull();
    expect(checkDuration("2030-01-01T10:00:00Z", null)).toBeNull();
    expect(checkDuration("not-a-date", "2030-01-01T10:00:42Z")).toBeNull();
    expect(
      checkDuration("2030-01-01T10:00:42Z", "2030-01-01T10:00:00Z"),
    ).toBeNull();
  });
});

describe("isHttpUrl", () => {
  it("accepts only absolute http(s) URLs", () => {
    expect(isHttpUrl("https://github.com/acme/web/actions/runs/1")).toBe(true);
    expect(isHttpUrl("http://ci.local/run/1")).toBe(true);
    expect(isHttpUrl("ftp://ci/run/1")).toBe(false);
    expect(isHttpUrl("javascript:alert(1)")).toBe(false);
    expect(isHttpUrl("not a url")).toBe(false);
    expect(isHttpUrl("")).toBe(false);
    expect(isHttpUrl(null)).toBe(false);
  });
});
