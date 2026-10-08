# R22 Inbox repair and check attempts

The check-attempt fix is a candidate to upstream to MonoCode (and Orca): a failed
attempt must not continue to count as a current failure after its rerun passes.

`src/shared/model/githubChecks.ts` groups by check kind, workflow, app, name and
context/matrix key. It orders attempts by suite/run order, attempt number and
timestamps, preserving blockers when there is no evidence of a newer success.
The Inbox and R19 host PR summaries share this helper. Native PR summaries use
the same ordering; detailed native check results retain history. The Checks view
shows current results and a quiet, collapsed “Earlier attempts” list per check.
When `gh` omits provider identity for duplicate external check names, one
paginated check-runs lookup per head supplies it. Missing or ambiguous metadata
preserves failed checks and leaves uncertain successful checks unknown.

Merged and closed PRs have no repair actions or needs-attention count. Active
repairs refresh their PR state even when the Inbox is closed. When a PR becomes
terminal, the repair stops and displays “Not needed: PR merged/closed”. Manager
repairs cancel their exact goal and its workers; ordinary chat repairs identify
their own user turn before stopping. Conversations, files and worktrees remain.
Cancellation is durable before delivery, so a Manager cannot delegate or retry
new work for a goal while its cancellation is being processed.

The repair picker offers the project's dedicated Manager Mono, with its name,
mascot and role. Selecting it creates a durable Manager goal using the existing
delivery path. Target/start failures remain in the picker. Legacy Manager chats
are archived with their transcripts retained and hidden from active chat lists;
the Manager's Details links to a read-only archived conversation reader.

## Verification evidence

On 2026-10-08, a read-only snapshot of `HenkDz/dzdistro` PR #1844 contained 59 raw
check runs. The shared grouping produced 20 current checks: 18 passed and 2
skipped. Its failed-then-passed runs stayed readable in collapsed history.
An isolated Chromium fixture rendered those actual runs, expanded the earlier
attempts, and verified a merged-state repair card with no repair action and one
stop callback. The fixture used an empty temporary project and a private browser
context; it did not change the PR or the user's app profile.

Focused tests cover check ordering and distinct workflow/app/matrix identities,
native history transport, Manager goal assignment, legacy/home Manager archives,
inline failures, merge cancellation, late starts and scoped repair tracking.
