# Project Manager review checklist

Use this checklist when reviewing work produced through Project Manager.

## Scope

- Compare the PR diff against the scope in the task or PR description.
- Flag any change that goes beyond what was asked, including unrelated
  refactors, formatting churn, or edits to files outside the assigned scope.
- Confirm that everything the task asked for is present in the diff.

## Checks

- Read the actual test results and command output. Do not assume CI passed
  just because a PR was opened.
- Verify that the relevant tests were actually run, not only described.
- Verify that they actually passed. Treat missing, skipped, or truncated
  output as unverified.

## Review

- If the work is incomplete, incorrect, or out of scope, request corrections
  before approving.
- Do not approve with reservations. Re-review once the corrections land.

## Merge

- Only the user (the human project owner) merges pull requests.
- Agents, workers, and managers must never merge, even after approval.
