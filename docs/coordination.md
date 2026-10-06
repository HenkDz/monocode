# Project managers

## Mono integration: upstream v0.8.0

The standalone `grand-orchestrator-spec.md` is superseded by `orchestrator-as-mono.md`: Monos remain the app-wide agents; Project Managers remain folder-scoped agents. The unfinished standalone prototype is parked, not shipped, at `d62c333` on local branch `nour-orchestrator-wip`. The merge starts from `bc71317` and integrates local tag `upstream-v0.8.0` (`0c77a85`). No push.

Phase 1 preserves both navigation models, Manager retention/recovery/identity, single-line worktrees, colored review cards, ntfy, branch force-delete confirmation, and upstream Monos/streaming/Inbox fixes. The shared Inbox cache retains both rate-limit fallback and latest-request protection. Opening a Mono supersedes pending Manager navigation. Right-docked Explorer support is retained alongside Mono detail panels.

Verification: 4,805 frontend tests passed, 13 skipped; TypeScript and production build passed. Native suite: 504 passed, 1 ignored, 1 failed (`mcp::tests::discovers_provider_configs_without_exposing_credentials` includes machine-installed providers rather than only fixture providers; `mcp.rs` is identical to upstream). An initial parallel native compilation exhausted memory; rerunning with one compiler job completed. An upstream habit test assumed a 12-hour locale; its assertion now also accepts the equivalent 24-hour display. Existing CSS-highlight and bundle-size warnings remain.

An isolated native profile (`com.monocode.desktop.mono-merge-test`) rendered Monos and Managers together. Opening the Mono displayed its own header; selecting Manager restored its standalone header with zero worktree tabs. No provider turn was submitted. Screenshots: [Mono and Manager side by side](../target/mono-merge-mono-dark.png), [Manager before reuse, dark](../target/mono-merge-manager-before-dark.png), [Manager before reuse, light](../target/mono-merge-manager-before-light.png). These use a test Mono and the real local checkout; installed-app sessions were not changed.

Latest round preserves the local `2f2fea7` navigation, queue, colored diffs/checks and notifications changes.

Each local Git project has a Manager row above its worktrees. Opening it uses a normal session pane; the blank pane is ephemeral. The first message starts the provider and the existing persistent Orchestrator. There is no enable form, checkout selector, coordination overlay or grand orchestrator.

The Manager is a standalone chat surface: its selected sidebar row opens a simple Manager header, without worktree tabs, a new-tab action, or the worktree Explorer panel. Worktree tab sets remain intact in the background. Managers are excluded from workspace tab memory, blank-pane replacement, split/drop chat placement and legacy worker-tab consolidation. Project-manager worker chats remain independently selectable. Superseded async selections cannot steal focus back from a later click.

Manager identity is derived from the canonical registered sidebar folder. A linked project folder has its own Manager, distinct from the repository root's Manager. It executes in that folder and uses the sidebar display name. Existing root-derived IDs and chats remain intact for the root project; linked folders receive new IDs. It cannot be retargeted through the composer.

## Worker lifecycle

- Delegate creates an isolated worker worktree. An optional checkout path or branch reuses an existing non-primary worktree named by the user. Missing, foreign and already-owned checkouts are rejected.
- Workers use full-access mode through the ordinary provider/session pipeline. Questions and approvals go to the manager's existing answer/respond tools.
- Several goals can run concurrently (four worker slots per manager). Independent worktrees do not contend for logical file scopes. Up to forty unreviewed assignments may be outstanding.
- New workers start at the registered folder's current branch. Each assignment captures that branch as its PR base; review rejects a PR targeting another branch. Existing assignments retain their original base after branch changes. Named worktrees retain their existing history; ownership checks span managers.
- The manager reads actual diffs and test results, asks workers for corrections, and opens a non-draft PR. Review confirms an open PR for that worker branch and records the exact accepted dispatch. It never integrates into the project root or deletes the worker checkout.
- PR ready means manager-reviewed with an open non-draft PR at review time, not a claim that remote branch-protection or CI gates have passed. The user reviews and merges.
- Worker status is displayed on its worktree row. Worker problems go to the Manager; the Manager row distinguishes running, explicit needs-decision blockers/escalations, new replies, and ready PRs, with a count of waiting items. Unseen plain-text replies get attention without falsely claiming every reply is a question.
- Accepted PRs have an inline card with the branch/worktree, checks summary, PR link, Open PR, Open diff (the committed GitHub PR diff), and Send back. Corrections resume the run and go to the retained worker. A failed send keeps the correction draft.
- Questions and ready PRs use the existing notification preferences and Inbox. Ordinary non-manager orchestration workers retain their notifications. OS notifications alone do not provide phone delivery.
- Shared PR status refreshes on focus, visibility and Git events. Merged/closed PRs clear readiness and stop forcing their worktrees into the sidebar. Failed lookups preserve the last known state; this is not a real-time webhook subscription.

## Persistence and recovery

The existing SQLite session/run storage, dispatch identities, request receipts, provider adapters and stop/recovery machinery remain authoritative. Idle Managers stay active across restart. Restart-interrupted workers continue automatically from retained sessions/worktrees, with a persisted status line in the Manager chat. Provider discovery completes before recovery. Saved Managers recover even when their pane is not selected.

A Manager turn is marked durably before submission. An interrupted/failed Manager turn, unavailable provider, save failure or safety blocker requires a decision: the shared amber badge/Inbox entry and inline **Continue** card explain why. Stopping a Manager interrupts rather than discards its workers. Sending a user message also resumes. The automatic-continuation budget resets on user turns; hitting its cap produces the same decision card. There is no sidebar Resume link. Ordinary orchestrator recovery remains manual.

Recovery never authorizes repeating uncertain external effects: workers must inspect existing work and push/PR outcomes before retrying. Dispatch IDs and request receipts remain authoritative, and concurrent hydration shares one restore operation. Automatic result delivery rechecks the lead after persistence so it cannot race a user's resumed turn.

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

## Round 3: recovery and worktree review (2026-10-06)

Previous polish and the colored diff/check chips were checkpointed locally in `8d2cf70`. This round preserves the standalone Manager navigation and does not change the sidebar Resume action.

1. **Worker recovery.** Manager can cancel a running worker, confirm it stopped, then call `reassign` with the same task ID, an available harness/model and a reason (`quota`, `unavailable`, `configuration`, `stuck`, `failed`). This creates a fresh session without mutating the old provider session. The task scope, dependencies, retained worktree/branch, commits and old conversation remain; uncertain external effects must be inspected first. Repeated request IDs return the same receipt, and late results from the previous dispatch cannot settle the replacement. Busy checkouts and already-started dependents block replacement. New assignments with omitted harness/model use the Manager's current selection, not an earlier worker's choice. There is currently no separate per-project worker-model setting.
   - Operational worker failures go to Manager, not directly to human notifications. Only explicit Manager questions/approvals require human attention. Scope/product decisions, destructive/irreversible authority and safety refusals still escalate. Provider switching must never bypass a safety refusal. The manager classifies recovery reasons; this is not a semantic safety-refusal detector or an enforcement sandbox.
2. **Two-way navigation.** The branch and Go to worktree button open the producing worker session through normal workspace navigation; its harness/model is displayed. PR ready on a worktree opens Manager and scrolls to that task's card, including repeated requests for the same card.
3. **Worktree menu.** New session offers installed harnesses; Open in reuses editor detection, folder reveal and terminal code. Give to Manager asks for a task and submits the named retained checkout. Open PR uses the known open PR; Create PR opens an explicit title/base/description form and requires clean, already-published commits. It never silently pushes. Removal reuses the existing confirmation and session-preserving lifecycle; primary checkouts are not removable here. Optional local branch cleanup uses Git's `-d`, never force deletion. Unmerged branches are retained. Partial cleanup reports that the worktree was removed and retries only branch cleanup, not deletion again. Remote branches are untouched.
4. **Checkout-specific counts.** Addition/deletion counts use each worktree's checkout, not the project aggregate. The sidebar-density round below replaces second-line metadata and removes the project change dot.
5. **Single-session rows.** Exactly one session opens directly from its worktree row without repeating the title. Multiple sessions retain their expandable list. Existing orchestration controls remain available even when their lead is the only session; their Resume behavior is unchanged.
6. **Review queue.** Manager expands into its owned worktrees, ordered blocked/needs decision, ready, then active work. User-created worktrees remain separate with independent pagination. A confirmed matching merged PR for the accepted dispatch changes the card to Merged with Remove worktree and puts the checkout in collapsed Done. A previous merged PR cannot hide a newer correction dispatch. Next cycles ready cards; Alt+Shift+N does the same while focus is in the cards, without intercepting correction typing. The chat status strip links running work, explicit user questions and ready cards. Per-project Active only hides idle/detached/merged rows, but retains focused or attention-needing work so navigation and user work do not disappear.

### Round 3 verification and screenshots

- Full frontend suite: **4,314 passed, 13 skipped** (405 passing files). Coverage includes provider replacement/idempotency/late callbacks, exact accepted-dispatch merge state, two-way card navigation, Next, queue sorting/filtering, per-checkout counts, single-session selection, primary protection, and partial removal recovery.
- Native: **12 worktree tests and 6 CLI tests passed**. This includes real temporary Git repositories proving checked-out and unmerged branches survive cleanup. Native-library clippy with warnings denied passes.
- TypeScript, production frontend and native debug builds pass. Existing production chunk-size/CSS-highlight warnings remain.
- Screenshots below use real components in a clearly labelled isolated fixture. The recovery screenshot runs the actual Orchestrator against an in-memory host and verifies a Codex-to-Claude replacement; no provider request, live PR, or remote write is implied. The fixture includes 102 idle worktrees. Sources: `target/round3-preview.tsx`, `target/round3-screenshots.mjs`.

| Item | Screenshot |
| --- | --- |
| 1. Retained, idempotent worker recovery | [Recovery](../target/manager-round3-1-recovery.png) |
| 2. PR cards and worker links; colored diffs/checks | [Cards](../target/manager-round3-2-review-cards.png) |
| 3. Worktree context menu | [Menu](../target/manager-round3-3-worktree-menu.png), [Open in](../target/manager-round3-3-open-in.png), [Agent picker](../target/manager-round3-3-agent-picker.png) |
| 4. Per-worktree counts | [Counts](../target/manager-round3-4-worktree-counts.png) |
| 5. Single-session worktree selection | [Single session](../target/manager-round3-5-single-session.png) |
| 6. Manager queue, merged card and collapsed Done | [Queue](../target/manager-round3-6-queue-merged.png), [Active only](../target/manager-round3-6-active-only.png), [Light theme](../target/manager-round3-6-light.png) |

Packaged deliverable: `target/manager-verified-preview/monocode-round3-final.exe` (same isolated preview identifier). Built, not relaunched over the user's active preview. Installed-app sessions were not changed. Local commits only; no push, PR publication, merge, deployment or phone notification was performed in this round.

## Mono org-chart amendment (in progress, 2026-10-06)

This supersedes the standalone Orchestrator prototype and the unified plan's project-count placement and direct-Orchestrator-worker rules. The checkpoints are local `aba0ed3` (Phase 2) and `a8c22d6` (unified ownership). The org-chart round is not yet a verified live deliverable.

- Upstream plain Monos retain their existing behavior. An optional role and direct boss form Orchestrator → one dedicated Manager per sidebar folder → persistent members. Only Managers own worker engines; the Orchestrator delegates goals and never directly creates workers. Existing Manager conversation IDs, engine IDs, retained tasks and worktrees are preserved during idempotent adoption.
- Default Backend, UI/UX and Reviewer members inherit the Manager's project and initial model. Team edits use the existing Details, Soul, Memory and model controls. Dispatches snapshot the member identity and model/settings; each turn loads that member's current Soul and bounded Memory. There are no member chat lanes.
- Direct edges are validated before dispatch. Reviewer approval is bound to both the implementing dispatch and Reviewer dispatch; old approval cannot unlock a correction. With no Reviewer, the card records Manager review. The existing native non-draft PR check remains required.
- Member facts use existing redacted, conflict-checked Mono memory, capped at three short facts per task. Workers have native app-token access to **only** `reviews.submit` and `memory.add`, only during an opted-in active turn. The frontend additionally authenticates the worker/task/member and dispatch. Manager Mono leads retain app tools; ordinary orchestration leads do not.
- Habits are not Manager turns. Owning-Habit identity exempts the Habit from the frontend checkout guard without setting or ending `managerTurnId`. Worker reports wait while the Manager is usage-limited; usage-limit failures do not pause the run. Other paused runs require Continue and cannot silently consume event turns.
- Permission safety deliberately fails closed: `team.answer` can deny a native permission, but cannot allow it. Event/Habit/report turns lack user authority; even user-origin turns cannot establish operation scope from the existing harness's display text. Until adapters provide trusted operation/path/risk metadata, **the user must use the original, still-visible approval controls**. This is stricter than automatic approval of apparently safe commands; text-based destructive/network/credential classification would be unsafe. Ordinary structured questions still go to the direct boss.
- Independent launches are preflighted before session/tab creation. Active Manager checkouts and retained non-cancelled worker checkouts (including descendants) reject unrelated sessions with explicit delegation guidance.
- The directional native path-overlap fix belongs to `HenkDz/mono-lock-fix`; this round does not alter overlap logic in `control_enable` or `control_authorize_turn`.

Per-member skills/MCP are deliberately not implemented. Follow-up adapter investigations: Claude Code per-launch settings/MCP/allowed-tool flags; Codex per-launch configuration and MCP overrides; OpenCode per-launch config; Pi/Hermes/OMP profile or extension configuration where their adapters support it. These are candidates, not claims of implemented isolation. The current product controls instructions, memory, harness and model; full-access workers are not a security sandbox.

Audit verification so far: eight native control tests pass, including Mono/plain-lead/worker capability separation and distinct, active-turn-only Habit control identity. The trusted UI associates a Manager Habit with its owning run before submission, without acquiring `managerTurnId` or sharing the Manager token. Focused validation: 322 frontend tests and TypeScript pass. These cover Habit ownership, usage-limit versus genuine pause, nested worker checkout exclusion, direct-edge enforcement and permission escalation. An unconstrained full frontend run exhausted Windows virtual memory; the two-worker rerun reached 4,823 passing tests with one sidebar-label regression, now fixed and passing in the focused suite. Live two-project/provider/PR acceptance and dark/light screenshots remain pending. No push, new remote PR, merge, deployment or phone notification has been performed.

## Sidebar density

- Active-only filtering is a project-row filter button, revealed alongside existing actions on hover, keyboard focus or touch. Its pressed state persists per project; an enabled filter stays visible, with a filtered-out count in the existing footer. Pagination remains independent for ordinary worktrees.
- Manager has a collapse arrow only when it owns worktrees, and shows the owned count when collapsed. Ownership is scoped to that sidebar project folder. Its worktrees are indented under a guide; primary and user-created worktrees align with Manager as siblings.
- Worktree and session titles stay single-line. Nonzero checkout counts occupy the right-hand slot; status takes priority. Hover/focus/touch replaces metadata with actions. Full worktree names remain in tooltips. Review in Manager remains available in the worktree menu.
- Matching closed or merged PRs for the current accepted dispatch move into collapsed Done; closed is never relabelled merged. Removal remains available there. A newer correction dispatch stays active. The project-row change dot is removed.
- Verification: **4,325 frontend tests passed, 13 skipped**; TypeScript and production frontend build passed (existing CSS-highlight and bundle-size warnings). No native code changed. Resume/identity and colored review cards are retained. The active native preview was not restarted or replaced.
- Screenshots use actual components with representative data for the same three projects, not live project state. The dzdistro fixture has 112 worktrees (107 paginated). Measured visible worktree rows are consistently 30px, previously up to 50.5px with metadata. Hover captures exercise the first Manager-owned row. Local fixture and capture script: `target/sidebar-density.tsx`, `target/sidebar-density-shots.mjs`.

| State | Before | After |
| --- | --- | --- |
| Dark idle | [Before](../target/sidebar-density-before-dark-idle.png) | [After](../target/sidebar-density-after-dark-idle.png) |
| Dark hover | [Before](../target/sidebar-density-before-dark-hover.png) | [After](../target/sidebar-density-after-dark-hover.png) |
| Dark filtered | [Before](../target/sidebar-density-before-dark-filtered.png) | [After](../target/sidebar-density-after-dark-filtered.png) |
| Light idle | [Before](../target/sidebar-density-before-light-idle.png) | [After](../target/sidebar-density-after-light-idle.png) |
| Light hover | [Before](../target/sidebar-density-before-light-hover.png) | [After](../target/sidebar-density-after-light-hover.png) |
| Light filtered | [Before](../target/sidebar-density-before-light-filtered.png) | [After](../target/sidebar-density-after-light-filtered.png) |

## Resume and folder identity verification

The following evidence records the Resume/identity baseline preserved by the sidebar-density round.

- Full frontend suite: **4,323 passed, 13 skipped** (405 passing files). Focused orchestration suite: **109 passed**. Regressions cover idle restore without even a transient pause, single retained-worker redispatch, interrupted Manager turns, provider discovery/unavailability, user-message budget reset, Stop preserving workers, folder identity/display name, captured PR bases, and the Continue card/attention state.
- Native: **13 worktree tests, 1 project-folder test and 2 PR-status tests passed**. A real linked-project fixture with a unique v4 commit proves worker HEAD equals v4 and differs from main. PR parsing exposes the base branch; frontend review rejects wrong/unknown bases, drafts, closed or missing PRs.
- TypeScript, native-library clippy with warnings denied, production frontend and native debug builds pass. Existing bundle-size warnings remain.
- Isolated native lifecycle test: actual process restart, native SQLite persistence and real Git worktrees, with a **deterministic worker adapter** (not a live model). The idle root Manager remained active; the separate v4 Manager continued its interrupted worker once with the same session/check­out and a new dispatch. A second process restart repeated this without duplicate submission. A forced Manager failure produced one decision and the amber Continue card. No push, PR, provider request or phone notification was sent.
- Evidence: [restored worker](../target/manager-identity-show.png), [Continue card and amber badge](../target/manager-identity-failManager.png), [native recovery state](../target/manager-identity-recover.json). Harness: `target/manager-identity-runtime.tsx` and `target/manager-identity-runtime.mjs`. The isolated test app and its dedicated dev server were closed afterward.
- Final local binary: `target/manager-verified-preview/monocode-manager-resume-identity-verified.exe`, SHA-256 `38cccc9c6456c814bdea0c96ed70cdb824f318bf528b7f8da2e4313fc0e19cd4`. Built for the existing isolated preview profile, **not launched over the user's active preview**. Installed-app sessions remain untouched.
