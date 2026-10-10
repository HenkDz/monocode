// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { GithubBudgetNotice, GithubBudgetUsage } from "./GithubBudgetNotice";
import { InboxPrChecks } from "./InboxPrChecks";
import { GithubPrActions } from "./GithubPrActions";
import {
  githubLimited, githubPollingAllowed, githubResetTime, noteGithubError,
  setGithubBudget, setGithubBudgetContext, type GithubApiBudget,
} from "../model/githubBudget";
import { setRemoteCommandRunner } from "../../../platform/tauri/fs";

let current: GithubApiBudget;
vi.mock("@tauri-apps/api/core", () => ({ invoke: async () => current }));
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  setGithubBudgetContext();
  current = { remaining: 0, limit: 5000, resetAt: new Date(Date.now() + 3600_000).toISOString(),
    resource: "graphql", status: "exhausted", calls: 1, points: 1, paths: {} };
  setGithubBudget(current);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  setGithubBudgetContext();
  setGithubBudget({ ...current, status: "unknown", remaining: null, resetAt: null });
  vi.unstubAllGlobals();
});

it("shows saved check data, reset time, and Settings usage with disabled GitHub actions", async () => {
  const refresh = vi.fn();
  await act(async () => root.render(createElement("div", null,
    createElement(GithubBudgetNotice), createElement(GithubBudgetUsage),
    createElement(InboxPrChecks, { onRefresh: refresh, view: {
      checks: { headOid: "saved-head", state: "open", checks: [{ name: "Saved build", workflow: "CI", state: "pass", url: null, startedAt: null, completedAt: null }] },
      loading: false, refreshing: false, error: null, stale: false, refresh,
    } }),
    createElement(GithubPrActions, {
      item: { projectPath: "/repo", repo: "org/repo", number: 1, state: "closed", draft: false },
      baseRef: "main", headRef: "fix",
    }),
  )));
  expect(container.textContent).toContain("showing last known data");
  expect(container.textContent).toContain(`resets at ${githubResetTime(current.resetAt)}`);
  expect(container.textContent).toContain("0 / 5,000 remaining");
  expect(container.textContent).toContain("Saved build");
  const refreshButton = container.querySelector<HTMLButtonElement>('[aria-label="Refresh checks"]')!;
  expect(refreshButton.disabled).toBe(true);
  expect(refreshButton.title).toContain("rate limit reached");
  expect([...container.querySelectorAll("button")].find(button => button.textContent?.includes("Reopen pull request"))?.disabled).toBe(true);
  refreshButton.click();
  expect(refresh).not.toHaveBeenCalled();
});

it("disables GitHub actions at low budget with an accurate quiet reason", async () => {
  current = { ...current, status: "low", remaining: 400 };
  setGithubBudget(current);
  await act(async () => root.render(createElement("div", null,
    createElement(GithubBudgetNotice),
    createElement(InboxPrChecks, { onRefresh: vi.fn(), view: {
      checks: null, loading: false, refreshing: false, error: null, stale: false, refresh: vi.fn(),
    } }),
  )));
  const button = container.querySelector<HTMLButtonElement>('[aria-label="Refresh checks"]')!;
  expect(button.disabled).toBe(true);
  expect(button.title).toContain("GitHub API budget is low · updates paused");
  expect(container.textContent).not.toContain("rate limit reached");
  expect(noteGithubError("GitHub rate limit reached · showing last known data")).toContain("budget is low");
  expect(githubLimited()).toBe(false);
});

it("sanitizes raw GraphQL and secondary limit errors and immediately pauses polling", async () => {
  setGithubBudget({ ...current, status: "ok", remaining: 5000 });
  const message = noteGithubError(new Error("GraphQL: API rate limit already exceeded for user ID 17301927"));
  expect(message).toContain("GitHub rate limit reached");
  expect(message).not.toContain("17301927");
  expect(githubLimited()).toBe(true);
  expect(githubPollingAllowed()).toBe(false);
  expect(noteGithubError("secondary rate limit; abuse detected")).not.toContain("abuse");
  await Promise.resolve();
});

it("uses the active remote budget and ignores late responses from the previous context", async () => {
  let resolveOld!: (budget: GithubApiBudget) => void;
  const remoteBudget = { ...current, status: "ok" as const, remaining: 4000 };
  const runner = vi.fn(async (_command: string, args: Record<string, unknown>) =>
    args.cwd === "remote://first/repo" ? new Promise<GithubApiBudget>(resolve => { resolveOld = resolve; }) : remoteBudget);
  setRemoteCommandRunner(runner);
  await act(async () => root.render(createElement(GithubBudgetUsage, { cwd: "remote://first/repo" })));
  expect(runner).toHaveBeenCalledWith("github_api_budget", { cwd: "remote://first/repo" });
  await act(async () => root.render(createElement(GithubBudgetUsage, { cwd: "remote://second/repo" })));
  expect(container.textContent).toContain("4,000 / 5,000 remaining");
  await act(async () => resolveOld(current));
  expect(container.textContent).toContain("4,000 / 5,000 remaining");
  expect(githubLimited()).toBe(false);
  await act(async () => noteGithubError("GraphQL: API rate limit already exceeded", "/local/repo"));
  expect(githubLimited()).toBe(false);
  await act(async () => root.render(createElement(GithubBudgetUsage, { cwd: "/local/repo" })));
  expect(container.textContent).toContain("0 / 5,000 remaining");
  expect(githubLimited()).toBe(true);
});

it("backs off for low budget and hidden windows and pauses until a valid reset", () => {
  setGithubBudget({ ...current, status: "low", remaining: 400 });
  expect(githubPollingAllowed()).toBe(false);
  setGithubBudget({ ...current, status: "ok", remaining: 4000 });
  expect(githubPollingAllowed()).toBe(true);
  vi.spyOn(document, "hidden", "get").mockReturnValue(true);
  expect(githubPollingAllowed()).toBe(false);
  setGithubBudget({ ...current, resetAt: "invalid" });
  expect(githubLimited()).toBe(true);
  setGithubBudget(current);
  expect(githubLimited(Date.parse(current.resetAt!) - 1)).toBe(true);
  expect(githubLimited(Date.parse(current.resetAt!) + 1)).toBe(false);
});
