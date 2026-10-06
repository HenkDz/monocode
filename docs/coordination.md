# Project managers

Each local Git project has a Manager row above its worktrees. Opening it uses a normal session pane; the blank pane is ephemeral. The first message starts the provider and the existing persistent Orchestrator. There is no enable form, checkout selector, coordination overlay or grand orchestrator.

The Manager is a standalone chat surface: its selected sidebar row opens a simple Manager header, without worktree tabs, a new-tab action, or the worktree Explorer panel. Worktree tab sets remain intact in the background. Managers are excluded from workspace tab memory, blank-pane replacement, split/drop chat placement and legacy worker-tab consolidation. Project-manager worker chats remain independently selectable. Superseded async selections cannot steal focus back from a later click.

Manager identity is derived from the native-resolved repository root, so opening the same repository through another registered checkout does not create another manager. The session keeps the existing sidebar project identity but executes at the repository root. It cannot be retargeted through the composer.

## Worker lifecycle

- Delegate creates an isolated worker worktree. An optional checkout path or branch reuses an existing non-primary worktree named by the user. Missing, foreign and already-owned checkouts are rejected.
- Workers use full-access mode through the ordinary provider/session pipeline. Questions and approvals go to the manager's existing answer/respond tools.
- Several goals can run concurrently (four worker slots per manager). Independent worktrees do not contend for logical file scopes. Up to forty unreviewed assignments may be outstanding.
- The manager reads actual diffs and test results, asks workers for corrections, and opens a non-draft PR. Review confirms an open PR for that worker branch and records the exact accepted dispatch. It never integrates into the project root or deletes the worker checkout.
- PR ready means manager-reviewed with an open non-draft PR at review time, not a claim that remote branch-protection or CI gates have passed. The user reviews and merges.
- Worker status is displayed on its worktree row. The Manager row distinguishes running, needs decision (including blocked/failed workers), new replies, and ready PRs, with a count of waiting items. Unseen plain-text replies get attention without falsely claiming every reply is a question.
- Accepted PRs have an inline card with the branch/worktree, checks summary, PR link, Open PR, Open diff (the committed GitHub PR diff), and Send back. Corrections resume the run and go to the retained worker. A failed send keeps the correction draft.
- Questions and ready PRs use the existing notification preferences and Inbox. Ordinary non-manager orchestration workers retain their notifications. OS notifications alone do not provide phone delivery.
- Shared PR status refreshes on focus, visibility and Git events. Merged/closed PRs clear readiness and stop forcing their worktrees into the sidebar. Failed lookups preserve the last known state; this is not a real-time webhook subscription.

## Persistence and recovery

The existing SQLite session/run storage, dispatch identities, request receipts, provider adapters and stop/recovery machinery remain authoritative. Reopening pauses uncertain work; sending a user message resumes it directly. Nothing is replayed just by opening its chat. Retries retain their worker session and worktree, and uncertain external effects must be inspected before retrying. Automatic result delivery rechecks the lead after persistence so it cannot race a user's resumed turn and spuriously pause the run.

The old preview's coordination metadata is not deleted or automatically migrated into active work. No separate registry, queue service, session database or hosting dependency was added.

Existing same-checkout writer reservations and provider availability checks still apply. Review/PR creation is agent-driven using the existing provider tools; no deterministic test can prove the quality of a model's review.

## Local verification (2026-10-06)

- Frontend final full suite: 4,301 passed, 13 skipped (402 passing files). This includes the continuation-race regression (56 orchestration tests). Focused card/attention/Inbox/notification checks: 28 passed.
- Host: 94 assertions passed, 12 skipped; the full invocation failed on the existing Windows EPERM cleanup in opencode-transport. That file passed when rerun alone. Do not call the full host invocation green.
- Native: canonical root/registered-worktree test passes; clippy all targets passes. Full Rust suite: 475 passed, 1 ignored, 1 failed. The unchanged MCP discovery fixture also discovers machine-level provider configs on this computer.
- TypeScript/Vite production build passes (existing CSS highlight/chunk-size warnings).
- Native isolated preview opens a normal Manager tab, hides checkout controls, and does not use the removed overlay.
- Live isolated preview confirmed zero durable sessions before and after opening the blank Manager, a normal Manager tab, and no visible checkout selectors. Sending the first message created the durable manager/run and real worker checkouts, with running status on their sidebar rows.
- Read-back through native session storage confirmed the worker transcripts and checkout bindings were persisted with full-access runtime mode.
- An earlier fixture was refused and stopped; its records/checkouts are retained. The later, separate documentation task used a real worker and manager review to create non-draft [PR #2](https://github.com/HenkDz/monocode/pull/2), base `nour`, head `ab6539a78bf88a5325587b27097d144c3ce3f1e9`. It adds only the 29-line `docs/project-manager-review-checklist.md`. The feature implementation is NOT in that PR.
- The live run exposed a native lookup bug: `gh pr list --head owner:branch` is unsupported. Lookup now uses the branch and separately verifies `headRepositoryOwner`; 15 native PR tests pass, and the corrected native preview resolves the actual PR.
- Recovery testing retained the actual manager/worker records in an isolated application profile, without fabricating review or completion. It also exposed and fixed the user-send/automatic-continuation race described above.
- Final live result at 11:59: run `finished`, task accepted against its actual dispatch, PR #2 recorded, checks summary persisted. The manager independently checked exact-head content, headings, whitespace, clean checkout and reported PR checks before calling real `review` and `finish` actions. Live DOM checks and screenshots confirmed the PR-ready card, green Manager indicator, worktree PR-ready status, Inbox Ready to merge entry, and focused correction input. The 800px-wide card keeps its buttons and content accessible. Send-back dispatch/failure/retry and notification deduplication are regression-tested; phone/OS delivery was not claimed as a live result.
- Full access is not a sandbox. During the earlier failed lookup, a manager diagnostic printed its local control grant into its saved transcript; that grant was revoked when the run stopped. Value-free inspection found no GitHub-token assignment/pattern. Instructions now explicitly prohibit credential/environment diagnostics and republishing after a lookup failure; this is behavioral guidance, not a deterministic data-loss-prevention boundary.
- The live worker transport also exposed a pre-existing Windows scratch-directory issue: Win32 device prefixes broke Git Bash TMPDIR. Worker prompts/environment now use a shell-compatible canonical path; the native private-directory/environment regression test passes.

No feature-source commit or push, merge, or deployment was performed. Only the explicitly scoped documentation worker commit/branch/PR was published. Preview executables use separate application identifiers and do not replace the installed app or its sessions. User-interacted preview windows were left untouched.

Latest packaged review executable: `target/manager-verified-preview/monocode-reviewed.exe` (identifier `com.monocode.desktop.manager-review-verified`). The running verified preview uses the corrected native binary with the final production frontend loaded through the local preview driver. Other running executable images were not overwritten or terminated.

### Standalone navigation correction (2026-10-06)

The user's click-through exposed legacy worker-tab consolidation and workspace pinning that mixed Manager and worker selection. Fixed those shared paths rather than hiding only the extra tab labels. Full frontend suite: 4,306 passed, 13 skipped; final workspace/navigation/sidebar checks: 86 passed. TypeScript and production frontend build pass. Live native-window checks passed repeated worker-to-Manager selection, new sessions in both primary and worker worktrees, latest-click-wins cancellation, one durable Manager identity, and the standalone header/selected row. No agent prompts or external writes were used in these navigation checks.

The rebuilt navigation-corrected executable is `target/manager-verified-preview/monocode-manager-fixed.exe`; the previous reviewed executable is retained, not overwritten while running. After an idle single-instance restart, the packaged application restored the standalone Manager with no worktree Explorer panel. The navigation click-through was repeated against the embedded production frontend, without frontend interception. Only the corrected executable remained running; saved Manager history and the finished run were retained.

## Phone notifications — proposal only

Start with one opt-in ntfy destination in Settings, not another orchestration service. Native outbound HTTPS sends only decision-needed and PR-ready events. Store any authorization credential in the OS credential store; use an unguessable/private topic. Default payload: project label, event type and optional PR link—no prompts, code, tool output or secrets. Reuse stable run/task/event identifiers for deduplication and bounded retries; include a test-notification button and delivery-error status. No inbound commands or exposure of MonoCode's local control port. Delivery requires MonoCode to be running and online; reliable asleep/offline delivery needs a separately approved hosted relay. Telegram can be a later adapter if required. No phone transport or settings were implemented.
