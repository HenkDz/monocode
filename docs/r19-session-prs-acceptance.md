# R19 session and worktree PRs

Implemented on `HenkDz/r19-session-prs` from `b20202db86915fed026a7424292324e9c38d2be0`. Source changes stay outside `src/features/teamMap`. App wiring changes seven lines.

## Verified causes and behavior

- `managerReviewTimeline` and `ProjectManagerReview` originally rendered PR cards only from accepted team tasks. Ordinary sessions now detect completed tool/assistant output, verify the PR against the checkout's GitHub/Enterprise repository or fork parent, and retain the first turn, block and checkout association. Streaming partial PR numbers are ignored.
- `git_pr_status_for` originally returned one PR for the current branch. Branch-local lookup remains available for creation and acceptance; the new list discovers checkout branch history and combines it with verified session URLs. Open PRs precede drafts, merged and closed history. Counts, hover text and menus expose the complete retained list.
- Team tasks use the same list and expose earlier/follow-up PRs while retaining their current review/acceptance flow. Approval remains tied to reviewed commits. Revocation, cleared URLs and late forge responses cannot restore an old approval.
- Ordinary merge-ready PRs appear in Inbox with their session and checkout labels. Unknown, unavailable, draft, conflicting, pending, failed or review-required snapshots do not qualify.
- Regular and org prompts now direct agents to the app's external worktree location. An untracked registered nested worktree raises a warning and offers confirmed cleanup of listed untracked `tmp/`/`temp/` files. Native cleanup checks paths, links/junctions, tracked state and content digests again. It preserves the worktree, other files and `.gitignore`.
- Session deletion removes its PR links after native deletion succeeds; worktree history and other sessions' links remain. Late refreshes cannot resurrect the deleted session's Inbox entry.
- Current CI attempts supersede older attempts of the same job/workflow. Matrix jobs and legacy status contexts remain distinct; ambiguous or unnamed checks retain blockers.

## Verification

- Full frontend: **5,395 passed, 13 existing skipped**, 507 files passed and 2 skipped. Command: `rtk proxy npm test -- --maxWorkers=2 --testTimeout=15000`, with `NODE_OPTIONS=--no-experimental-webstorage`.
- The default five-second runs timed out in the existing CRLF editor test, followed by cleanup-related failures. Its four assertions passed in isolation and in the full run with the longer timeout; assertions and test source were preserved.
- Final focused PR/model/hook/card/session-deletion/team/Inbox regressions: **78 passed**. Sidebar/source-control regressions: **57 passed**. Guidance/warning checks: **18 passed**. These overlap the full suite.
- Relevant native PR tests: **25 passed**. Native nested-cleanup tests: **2 passed**.
- Connected Host PR tests: **15 passed**; Host TypeScript and packaging build passed. An additional broad Host run hit one Codex transport idle deadline; that test passed on its isolated rerun.
- Frontend TypeScript, production build, isolated native build and `git diff --check` passed. Build output retains the existing CSS/highlight and chunk-size warnings.

## Actual isolated preview

The preview uses identifier `com.monocode.desktop.r19-session-prs-test`, isolated app data, and launch directory `%TEMP%/monocode-r19-empty-launch`.

A genuine regular Codex session `2b747e5a-31ab-4594-ad76-f4bc0d33efcf` worked in an isolated DZDistro clone whose current branch already had merged PR #1823 (`dependabot/npm_and_yarn/staging/npm-maintenance-e855eb3603`). The agent created a sibling external worktree and opened [disposable PR #1845](https://github.com/HenkDz/dzdistro/pull/1845):

- Title: `[test] MonoCode R19 regular session follow-up PR`.
- Base/head: `staging` ← `test/r19-session-pr-20261008`; commit `5f9878a`.
- Exact change: `docs/r19-test-pr.md`, +1/−0.
- The ordinary session timeline rendered the forge-verified card and actions. The original checkout displayed the newer open PR and **14 PRs**: 13 entries from branch history plus this detected follow-up.
- The test PR was closed after capture, with `closedAt=2026-10-08T16:00:43Z` and no merge. Its card updated to Closed; a preview restart retained its session association and the 14-entry history.
- The original checkout stayed clean on its existing merged-PR branch. The disposable follow-up checkout stayed clean. The remote test branch was retained.

Evidence is in the local ignored `target/r19-verification/` folder: `live-pr-open-dark.png`, `final-closed-dark.png`, `final-closed-light.png`, `final-menu-light.png`, `final-menu-closed-light.png`, `final-live-receipt.json`, `test-pr-closed.json`, and `final-frontend-15sec.log`. The original second dark capture was renamed accurately; the light captures were checked against `theme-light` and a light computed background.

The final rebuilt/restarted delivery executable is `target/r19-verification/monocode-r19-delivery.exe`, SHA256 `eac406833bd6365ea42548f8bbc2eb01847a9e7928ad797460dfc1e8dcac7f44`. The final captures and restart receipt use that artifact.

The disposable PR's repository CI was pending at open capture and subsequently failed/cancelled. Merge-ready Inbox behavior is covered by verified-state tests; no live merge-ready claim is made for this fixture.

## Scope limits

GitHub and GitHub Enterprise are supported. Remote PR transport and Enterprise trust behavior have focused coverage; live capture used local native execution and public GitHub. Nested warnings/cleanup cover local registered untracked worktrees. Discovery scans 20 recent historical branches and 100 PRs per branch; detected session URLs persist independently. Checks with missing/tied attempt timestamps conservatively retain blockers. Source was committed locally; no R19 code branch was pushed.
