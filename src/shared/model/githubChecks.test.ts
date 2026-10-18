import { expect, it } from "vitest";
import {
  enrichGithubCheckApps,
  githubActionsSuiteId,
  githubChecksMissingApps,
} from "./githubChecks";

it("requests identity metadata only for colliding external names without app metadata", () => {
  const check = { name: "scan", workflowName: "" };
  expect([...githubChecksMissingApps([check])]).toEqual([]);
  expect([...githubChecksMissingApps([check, check])]).toEqual(["scan"]);
  expect([
    ...githubChecksMissingApps([
      { ...check, workflowName: "CI" },
      { ...check, workflowName: "CI" },
    ]),
  ]).toEqual([]);
  expect([
    ...githubChecksMissingApps([
      { ...check, app: "a" },
      { ...check, app: "b" },
    ]),
  ]).toEqual([]);
});

it("matches same-vendor and null URLs by timestamps, keeping apps separate and true reruns together", () => {
  for (const url of ["https://vendor.example/check", null]) {
    const rows = ["10", "11", "12"].map((hour, index) => ({
      name: "scan",
      workflowName: "",
      detailsUrl: url,
      startedAt: `2026-10-08T${hour}:00:00Z`,
      conclusion: index === 0 ? "FAILURE" : "SUCCESS",
    }));
    const metadata = rows.map((row, index) => ({
      name: row.name,
      details_url: row.detailsUrl,
      started_at: row.startedAt,
      app: { id: index === 1 ? 2 : 1 },
      check_suite: { id: index + 1 },
    }));
    expect(enrichGithubCheckApps(rows, metadata).map((row) => row.app)).toEqual(
      ["1", "2", "1"],
    );
    expect(
      enrichGithubCheckApps(rows, metadata).map((row) => row.suiteId),
    ).toEqual([1, 2, 3]);
  }
});

it("missing or indistinguishable identity metadata preserves failures and marks green ambiguity unknown", () => {
  const rows = [
    { name: "scan", conclusion: "FAILURE" },
    { name: "scan", conclusion: "SUCCESS" },
  ];
  for (const metadata of [[], [{ name: "scan", app: { id: 1 } }]]) {
    const enriched = enrichGithubCheckApps(rows, metadata);
    expect(enriched.map((row) => row.app)).toEqual([
      "unresolved:0",
      "unresolved:1",
    ]);
    expect(enriched.map((row) => row.conclusion)).toEqual([
      "FAILURE",
      "UNKNOWN",
    ]);
  }
  const dated = rows.map((row) => ({
    ...row,
    startedAt: "2026-10-08T10:00:00Z",
  }));
  const metadata = [1, 2].map((id) => ({
    name: "scan",
    started_at: "2026-10-08T10:00:00Z",
    app: { id },
  }));
  expect(enrichGithubCheckApps(dated, metadata).map((row) => row.app)).toEqual([
    "unresolved:0",
    "unresolved:1",
  ]);
});

it("malformed run URL segments cannot drive suite ordering", () => {
  expect(
    githubActionsSuiteId(
      "https://github.com/acme/web/actions/runs/123/job/456",
    ),
  ).toBe(123);
  expect(
    githubActionsSuiteId(
      "https://github.com/acme/web/actions/runs/123garbage/job/456",
    ),
  ).toBeUndefined();
});
