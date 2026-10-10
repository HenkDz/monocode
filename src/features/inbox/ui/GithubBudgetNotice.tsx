import { githubResetTime, useGithubBudget } from "../model/githubBudget";

export function GithubBudgetNotice({ cwd }: { cwd?: string }) {
  const budget = useGithubBudget(cwd);
  return budget.limited ? (
    <p role="status" className="shrink-0 border-b border-stroke px-4 py-2 text-[12px] text-content/55">
      {budget.message}
    </p>
  ) : null;
}

export function GithubBudgetUsage({ cwd }: { cwd?: string }) {
  const budget = useGithubBudget(cwd);
  const reset = githubResetTime(budget.resetAt);
  return <p className="text-[12px] text-content/55" data-github-api-usage>
    GitHub API: {budget.remaining == null || budget.limit == null
      ? "usage available after the next GitHub read"
      : `${budget.remaining.toLocaleString()} / ${budget.limit.toLocaleString()} remaining`}
    {reset ? ` · resets at ${reset}` : ""}
  </p>;
}
