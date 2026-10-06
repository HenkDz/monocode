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

At that stage, no feature-source commit or push, merge, or deployment was performed. Only the explicitly scoped documentation worker commit/branch/PR was published. Preview executables use separate application identifiers and do not replace the installed app or its sessions. User-interacted preview windows were left untouched.

Latest packaged review executable: `target/manager-verified-preview/monocode-reviewed.exe` (identifier `com.monocode.desktop.manager-review-verified`). The running verified preview uses the corrected native binary with the final production frontend loaded through the local preview driver. Other running executable images were not overwritten or terminated.

### Standalone navigation correction (2026-10-06)

The user's click-through exposed legacy worker-tab consolidation and workspace pinning that mixed Manager and worker selection. Fixed those shared paths rather than hiding only the extra tab labels. Full frontend suite: 4,306 passed, 13 skipped; final workspace/navigation/sidebar checks: 86 passed. TypeScript and production frontend build pass. Live native-window checks passed repeated worker-to-Manager selection, new sessions in both primary and worker worktrees, latest-click-wins cancellation, one durable Manager identity, and the standalone header/selected row. No agent prompts or external writes were used in these navigation checks.

The rebuilt navigation-corrected executable is `target/manager-verified-preview/monocode-manager-fixed.exe`; the previous reviewed executable is retained, not overwritten while running. After an idle single-instance restart, the packaged application restored the standalone Manager with no worktree Explorer panel. The navigation click-through was repeated against the embedded production frontend, without frontend interception. Only the corrected executable remained running; saved Manager history and the finished run were retained.

## Sidebar and review-card polish (2026-10-06)

Checkpoint `1e23d16` on `nour` preserves the complete Manager implementation and standalone navigation fix locally. No source push. Acceptance-only PR #2 was closed and its remote branch `mc/orch-ace7d48a5289` deleted; the local checkout and history remain.

- The project row has keyboard/touch-accessible hover menu and Create new worktree actions. The redundant Worktrees header is removed. Manager is its first child, separated by 2px and sharing the worktree-row inset.
- Only active leaves receive a selected fill; the containing project only receives brighter text. The Manager avatar uses the project's mascot/color, with a corner attention badge and a right-side count only above one. It is reused on chat receipts and review cards.
- PR cards use UI typography, compact PR/diff/check chips, a collapsed Manager's review, a tooltip-only absolute path, and a primary Open PR action. Check chips come from the existing GitHub checks API, not a parser guessing from the Manager's prose. Unavailable metadata is labelled unavailable, never passed.
- New Manager instructions ask for a single-line final PR announcement; detailed findings belong in the card. Historical replies remain intact so old warnings and limitations are not silently hidden.
- New worker branches use a task-title slug. Native Git-config reservations retain the task-to-branch mapping before creation, use a numeric suffix on collisions, and make interrupted creation recoverable. Existing worker branches are not renamed. Manager-owned worktree labels use the most recent task title; the branch remains in the tooltip. Named branch cleanup requires a recorded worker reservation, not just an `mc/` prefix.
- Deferred: card-level Merge. Existing Inbox already offers a user confirmation flow; extracting it cleanly into a shared card action is a separate change. The Manager's instructions and control actions still do not merge. Full-access workers are not an enforcement sandbox.
- Deferred: hiding empty sessions. The sidebar summary alone cannot reliably distinguish a truly empty conversation from one with an unsent draft. Retaining those rows avoids hiding user work.

### Phone notifications

Settings → Inbox → Phone notifications implements opt-in ntfy delivery. It is off by default. Configure an HTTPS server and topic, optionally an access token, save, then use Send test. Subscribe to the same topic in the phone app. Use an access-controlled topic or a long unpredictable name; see the [ntfy publishing documentation](https://docs.ntfy.sh/publish/).

On Windows, both destination and token are stored in Windows Credential Manager under the application's identifier, never in frontend storage or plaintext settings. Tokens are never returned to the frontend. Leaving the token field blank preserves it only for the same server; changing the server clears it, and Remove saved token explicitly clears it. Unsupported platforms show a disabled feature until native secure-store support is added; there is no plaintext fallback.

Native delivery sends fixed decision-needed or PR-ready text only—no project names, paths, prompts, code, tool output, PR URLs, or inbound actions. HTTPS is required, URL credentials/query/fragment are rejected, redirects are refused, and response bodies/transport details are omitted from errors. A settings change cancels subsequent attempts. Three attempts maximum, ten-second request timeout, with 1s/3s backoff for transient failures; authentication failures do not retry.

SQLite retains up to 500 hashed event identities and delivery status, with at most 20 pending deliveries. Successful or failed identities are not automatically re-enqueued. Interrupted deliveries are marked interrupted after a minute, not blindly replayed. A remote timeout may have succeeded, so bounded retry can still duplicate a phone alert; this is not an exactly-once transport. MonoCode must be running and online. No hosted relay, offline queue or remote approval endpoint is introduced. Settings shows delivery status/errors and offers an explicit test. Events that occurred while disabled are not replayed immediately upon enabling.

Verification: final full frontend rerun passed 4,308 tests with 13 skipped (404 passing files); the final spacing adjustment also passed the 28-test Manager/transcript/naming subset. The first parallel run exposed a stale group-hover assertion (corrected) and three unchanged Git-test timeouts (passed individually and in the reduced-concurrency full rerun). Eleven native worktree tests pass, including collision/recovery/ownership. Four native ntfy tests pass, including an actual disposable Credential Manager round trip and localhost transport checks for 503 retry, 401 rejection, redirect refusal, retry exhaustion and settings-change cancellation. TypeScript, the production frontend, native debug build and native-library clippy with warnings denied pass. No real phone destination was configured or notified; receipt on a phone still requires the user's destination and Send test.

Packaged runtime verification (not frontend interception): the new executable restores the existing preview history, opens Manager as a standalone chat, and passes four primary/worker-worktree → Manager round trips. The project-row + opens the real creation dialog, cancelled without creating a worktree. Native ntfy settings report off by default and secure storage available; an HTTP destination is rejected and disabled test delivery sends nothing. No agent messages were submitted. One MonoCode process remains, running `monocode-polished.exe`; no existing app process was killed. [Native screenshot](../target/manager-polish-native.png).

### Screenshot acceptance

These are real sidebar/card components rendered in an isolated browser harness with explicitly labelled sample PR metadata. They do not reopen PR #2 or fabricate acceptance in saved sessions. The capture harness is `target/polish-preview.tsx`; `target/polish-screenshots.mjs` captures both themes.

| State | Dark | Light |
| --- | --- | --- |
| Sidebar idle | [Screenshot](../target/manager-polish-dark-idle.png) | [Screenshot](../target/manager-polish-light-idle.png) |
| Project hover | [Screenshot](../target/manager-polish-dark-hover.png) | [Screenshot](../target/manager-polish-light-hover.png) |
| Manager selected | [Screenshot](../target/manager-polish-dark-selected.png) | [Screenshot](../target/manager-polish-light-selected.png) |
| Manager ready badge | [Screenshot](../target/manager-polish-dark-ready.png) | [Screenshot](../target/manager-polish-light-ready.png) |
| Review card | [Screenshot](../target/manager-polish-dark-card.png) | [Screenshot](../target/manager-polish-light-card.png) |

Latest local executable: `target/manager-verified-preview/monocode-polished.exe`, using the existing isolated `com.monocode.desktop.manager-review-verified` profile. The installed app is not replaced.
