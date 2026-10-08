/** Stable identity excludes run/job URLs, which change on each attempt. Matrix keys stay distinct. */
export type GithubCheckIdentity = {
  name: string;
  workflow?: string;
  app?: string;
  context?: string;
  kind?: string;
  runAttempt?: number | null;
  suiteId?: number | null;
  startedAt?: string | null;
  completedAt?: string | null;
  state: string;
};

export function githubCheckIdentity(
  check: Pick<
    GithubCheckIdentity,
    "kind" | "workflow" | "app" | "name" | "context"
  >,
): string {
  return JSON.stringify([
    check.kind ?? "CheckRun",
    check.workflow ?? "",
    check.app ?? "",
    check.name,
    check.context ?? "",
  ]);
}

/** Missing ordering evidence must never turn an unresolved failure into a green result. */
function compareChecks(a: GithubCheckIdentity, b: GithubCheckIdentity): number {
  for (const key of ["suiteId", "runAttempt"] as const) {
    const left = a[key],
      right = b[key];
    if (left != null && right != null && left !== right) return left - right;
  }
  const stamp = (check: GithubCheckIdentity) =>
    [check.startedAt, check.completedAt]
      .map((value) => (value ? Date.parse(value) : NaN))
      .find(Number.isFinite);
  const left = stamp(a),
    right = stamp(b);
  if (left !== undefined && right !== undefined && left !== right)
    return left - right;
  const rank = (state: string) =>
    ["fail", "failure", "cancel"].includes(state)
      ? 4
      : state === "unknown"
        ? 3
        : state === "pending"
          ? 2
          : 0;
  return rank(a.state) - rank(b.state);
}

export function groupGithubChecks<T extends GithubCheckIdentity>(
  checks: readonly T[],
): { latest: T; earlier: T[] }[] {
  const groups = new Map<string, { latest: T; earlier: T[] }>();
  checks.forEach((check, index) => {
    const key = check.name.trim()
      ? githubCheckIdentity(check)
      : `anonymous:${index}`;
    const group = groups.get(key);
    if (!group) groups.set(key, { latest: check, earlier: [] });
    else if (compareChecks(check, group.latest) > 0) {
      group.earlier.push(group.latest);
      group.latest = check;
    } else group.earlier.push(check);
  });
  return [...groups.values()].map((group) => ({
    ...group,
    earlier: group.earlier.sort((a, b) => compareChecks(b, a)),
  }));
}

export function githubActionsSuiteId(
  url: string | null | undefined,
): number | undefined {
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    const id = Number(
      /^\/[^/]+\/[^/]+\/actions\/runs\/([1-9]\d*)(?:\/|$)/.exec(
        parsed.pathname,
      )?.[1],
    );
    return parsed.hostname === "github.com" &&
      Number.isSafeInteger(id) &&
      id > 0
      ? id
      : undefined;
  } catch {
    return undefined;
  }
}

type CheckRow = Record<string, unknown>;
export function githubCheckAppIdentity(value: unknown): string {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return "";
  const app = value as CheckRow;
  return typeof app.id === "number"
    ? String(app.id)
    : String(app.slug ?? app.name ?? "");
}

/** gh omits app identity; enrich only colliding external names, once per head. */
export function githubChecksMissingApps(
  rows: readonly CheckRow[],
): Set<string> {
  const names = new Map<string, CheckRow[]>();
  for (const row of rows) {
    if (
      row.__typename === "StatusContext" ||
      row.context ||
      row.workflowName ||
      typeof row.name !== "string" ||
      !row.name.trim()
    )
      continue;
    names.set(row.name, [...(names.get(row.name) ?? []), row]);
  }
  return new Set(
    [...names]
      .filter(
        ([, checks]) =>
          checks.length > 1 &&
          checks.some((check) => !githubCheckAppIdentity(check.app)),
      )
      .map(([name]) => name),
  );
}

export function enrichGithubCheckApps(
  rows: readonly CheckRow[],
  metadata: readonly CheckRow[],
): CheckRow[] {
  const names = githubChecksMissingApps(rows);
  return rows.map((row, index) => {
    if (
      !names.has(String(row.name)) ||
      row.workflowName ||
      githubCheckAppIdentity(row.app)
    )
      return row;
    const hasEvidence = [row.detailsUrl, row.startedAt, row.completedAt].some(
      (value) => typeof value === "string" && value.length > 0,
    );
    const matches = metadata.filter(
      (check) =>
        hasEvidence &&
        check.name === row.name &&
        [
          [row.detailsUrl, check.details_url],
          [row.startedAt, check.started_at],
          [row.completedAt, check.completed_at],
        ].every(([expected, actual]) => !expected || expected === actual),
    );
    const apps = new Set(
      matches.map((check) => githubCheckAppIdentity(check.app)).filter(Boolean),
    );
    if (
      apps.size === 1 &&
      matches.every((check) => githubCheckAppIdentity(check.app))
    ) {
      const suite =
        matches.length === 1
          ? (matches[0].check_suite as CheckRow | undefined)
          : undefined;
      return {
        ...row,
        app: [...apps][0],
        ...(typeof suite?.id === "number" ? { suiteId: suite.id } : {}),
      };
    }
    // Failed/missing metadata cannot erase a blocker or make an ambiguous check green.
    const blocker = [
      "FAILURE",
      "ERROR",
      "TIMED_OUT",
      "ACTION_REQUIRED",
      "STARTUP_FAILURE",
      "CANCELLED",
    ].includes(String(row.conclusion).toUpperCase());
    return {
      ...row,
      app: `unresolved:${index}`,
      ...(!blocker ? { status: "COMPLETED", conclusion: "UNKNOWN" } : {}),
    };
  });
}
