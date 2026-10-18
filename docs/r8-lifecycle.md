# R8 lifecycle and team cards

Managers close finished reports with `control review {"taskId":"…","outcome":"accept-no-changes"}`. The engine verifies the checkout against its starting snapshot before accepting that exact dispatch. Inherited dirty edits are allowed; edits and commits since task start are rejected. Legacy tasks use their earliest recorded snapshot when available, otherwise acceptance is labelled **Completed (no changes, baseline unknown)**. Existing unfinished reports remain unchanged until the Manager explicitly accepts them. Changed tasks retain the independent Reviewer and non-draft PR gate.

Investigation delegates use `readOnly:true`. Codex and Claude run in the Manager's project checkout with enforced read-only permissions, without creating a task worktree. Unsupported harnesses receive an isolated worktree and an explicit fallback explanation. The worker cannot elevate its permissions; its managed read-only setting survives hydration. Completion compares an immutable baseline, including existing dirty content, and blocks/escalates detected modifications. Concurrent checkout changes conservatively block acceptance.

Team changes from one Manager turn appear in one card per hiring/update action, with one row per member, plain Soul summaries, expandable full text, Edit, and whole-action Undo. Undo preserves user locks and newer edits; undoing the initial hire action can restore an empty team. Reviewer defaults prefer a different available harness or model family. Explicit profiles remain authoritative, with a same-model warning when appropriate.

Delegated Manager goal cards require an Orchestrator and actual goals, at both emission and rendering. Reports omit tooling chatter. Task cards start collapsed unless they need the user, and manual expansion survives remounts during the session. Activity uses sidebar project names with paths in tooltips. Verified no-change acceptance appears as Completed / Completed (no changes), joins Recently finished and Finished, and updates header counts.

## Acceptance evidence

| Check | Result |
| --- | --- |
| Full frontend | 5,035 passed; 13 skipped, including the final reviewer-availability fallback and attempted-write regressions. |
| TypeScript and production web build | Passed. |
| Host build and full suite | 95 passed; 12 platform skips. |
| Relevant native tests | 15 worktree tests and 15 control-CLI tests passed. |
| Read-only provider enforcement | 14 launch/turn plan checks passed, including write/permission elevation denial. |
| Lifecycle and persistence | 91 lifecycle tests; 54 persistence/restore tests passed. |
| Independent cross-feature scan | Passed. |

The component captures use real components in a labelled isolated fixture: [dark](../target/r8-screenshots/r8-cards-fixture-dark.png), [light](../target/r8-screenshots/r8-cards-fixture-light.png). They cover grouped hire/update cards, collapsed In review and Completed cards, finished header counts and Activity display names.

The real native acceptance uses the separate `com.monocode.desktop.r8-lifecycle-test` identifier, launched from an empty temp folder outside Git ancestry. The installed preview was not restarted. The test project is a fresh clone of remote `nour` at `283e61ad28314d06302cae3fabfa359c3c43a9e1`; implementation work stays on local `HenkDz/r8-lifecycle-cards`, based on `359824a`.

The Manager hired Docs on `codex:gpt-6.1-sol` and defaulted its Reviewer to `claude:opus`. The native transcript contains one grouped Team hired card and no delegated-Manager card. Read-only task `39318522-6fa8-4962-9e97-f5a466dc5e80` was explicitly accepted with `completionOutcome:no-changes`, no task worktree and a finished count of one. The existing event-authority guard refused a new code delegation from a report turn; the test driver continued the already-authorized code stage through an explicit user turn. No authority guard was bypassed.

Changed task `056380d0-c2e9-4610-91a5-36ca96c72fcf` created the sole disposable Markdown document in an isolated task worktree. Existing worker rules prohibit staging/committing, so the Manager inspected and committed it at `6d51ca8a992936b73e31b734cc439f374d45dc8d`. Retained Reviewer task `bc741ba1-2153-4820-9b1f-e608f1cb9758`, still Claude/read-only, approved implementation dispatch `e356bbb7-3b4d-476a-b356-c90f07fd83a4` and was explicitly completed without changes. The Manager accepted the implementation's exact latest dispatch through the PR gate. Before closure, the native header showed one ready and two finished tasks.

The live Claude Reviewer also exposed an attempted-write false positive: pending Write-tool metadata appeared before any actual modification, while the immutable checkout baseline remained unchanged. Read-only event handling now verifies actual checkout deltas before blocking; final completion verification and provider write-denial safeguards remain in force. Regression coverage includes pending/outside-checkout metadata, real project modifications and failed Git verification. Explicit retry on the rebuilt preview retained the same Reviewer session, Claude model and immutable baseline; it completed successfully.

The final native executable is `target/monocode-r8-final.exe`, SHA-256 `0e211b354a94f47be551f6c2d30438a72e43f890cb0ad20238345238b4490c9d`. Its isolated restart (`106908` → `80624`) retained the accepted read-only result and dispatch binding. The rebuilt preview includes the final reviewer-profile availability fallback and attempted-write fix.

[Disposable test PR #6](https://github.com/HenkDz/monocode/pull/6) was verified open/non-draft at acceptance, then **closed after capture**, never merged. Its base is `nour`, head is `mc/create-disposable-lifecycle-document` at `6d51ca8a992936b73e31b734cc439f374d45dc8d`, and its only file is `docs/r8-disposable-lifecycle-test.md`. The disposable branch remains retained. No implementation branch was pushed.

Final native captures: [Activity dark](../target/r8-final-activity-dark.png), [Activity light](../target/r8-final-activity-light.png), [member cards dark](../target/r8-final-member-dark.png), [member cards light](../target/r8-final-member-light.png), [team dark](../target/r8-final-team-dark.png), [team light](../target/r8-final-team-light.png). The read-only-only phase also has [dark Activity](../target/r8-readonly-activity-dark.png) and [light Activity](../target/r8-readonly-activity-light.png) captures.

The saved [run evidence](../target/r8-live-evidence-final.json) and [closed PR evidence](../target/r8-test-pr-final.json) pass the runnable check `rtk proxy node target/r8-assert-live.mjs`, verifying no-change acceptance, different reviewer harness, exact dispatch approval, retained worktree, PR head/base, sole changed file and closed state. The isolated preview remains idle.
