# R10 team feel

Roles guide coordination. Teammates can ask each other directly, with messages in the Manager's crew feed. Cross-team questions route through the recipient's Manager, and repeated exchanges on a topic suggest involving the Manager. Messages retain event authority through queued delivery.

Review remains the default for code changes. A Manager can mark a change trivial, with an explicit “Not reviewed (trivial)” label. Retiring the last Reviewer leaves a visible warning. Agent merges, destructive operations without the user, identity spoofing, and unsafe permission elevation remain protected.

The Activity panel shows the org hierarchy, current tasks, worker activity and elapsed time. Crew events come from persisted assignments, results, reviews, hand-offs, PRs and user decisions. Member headers use the same task availability as the sidebar. Team worker sessions, including read-only sessions and retained dispatches, do not contribute to “Your worktrees”.

PR delivery watches commit, CI and conflict evidence in the background. Repairs return to the original task and retained checkout. New commits make approval outdated and request fresh review. Hand-off notes and recent project summaries accompany continuing work; the existing member memory is retained.

New session, Mono and Reviewer defaults are `codex:gpt-6.1-sol`, following the user's latest instruction. Explicit user selections and historical run provenance remain intact.

## Verification

- Full frontend: 5,229 passed, 13 skipped, including teammate routing, scoped metadata, progress-message routing, role defaults, PR discovery, org roll-up and Windows read-only launch coverage.
- Host: 95 passed, 12 platform skips.
- TypeScript and production/native builds pass.
- Native: 538 passed, 1 ignored, 1 environment-dependent failure in `mcp::tests::discovers_provider_configs_without_exposing_credentials`, caused by actual global MCP configurations being discovered alongside its fixture. Relevant control CLI and PR metadata tests pass.
- Independent policy, UI and delivery integration review completed.

The live exercise exposed the native worker allowlist missing `team.message`, which was corrected with scoped grant tests. The initial Orchestrator Auto turn also encountered Windows sandbox initialization failures; only the isolated preview was changed to Full access and continued. Codex code-mode custom tools now opt into raw tool events for new threads. The installed provider's resume schema does not document this flag, so raw activity for older resumed threads remains provider-dependent; normal command and MCP activity continues to work.

Windows read-only workers use the supported `unelevated` sandbox backend per process after the elevated setup failed in this environment. A disposable native GPT-6.1-Sol probe read its marker, received a real access-denied error for a write, and left no probe file. Thread filesystem policy stays read-only; global configuration and credentials are not copied or edited. This backend has weaker network isolation than the elevated backend. [OpenAI Windows sandbox documentation](https://learn.chatgpt.com/docs/windows/windows-sandbox)

Isolated live acceptance evidence is recorded below when complete. The implementation branch is local only. Any disposable test PR is closed after capture and never merged.

The native preview uses `com.monocode.desktop.r10-team-feel-test` and an empty launch folder at `%TEMP%/monocode-r10-empty-launch`. Final delivery executable: `target/monocode-r10-delivery.exe`, SHA-256 `54774f97a50e4c1ff4c429cca865072ce1ecb5e84e68a9b7073311950ab6783c`. The installed app was not replaced.

Actual provider work verified the member header/sidebar availability, live task activity and read-only Reviewer session grouping in both themes. Backend delivered a real teammate question; UI supplied “Team activity” through the Manager. The genuine read-only GPT-6.1-Sol Reviewer inspected the corrected three-file demo, ran fresh assertions and submitted an authenticated review artifact and verdict. The test's initial GPT-5.6-Sol runs followed the opening brief; subsequent current profiles and new defaults use GPT-6.1-Sol after the user's correction. Historical run models were preserved.

## Live delivery result

[Disposable PR #8](https://github.com/HenkDz/monocode/pull/8) targeted `nour` from `mc/implement-r10-live-acceptance-demo`. Its only files were `.github/workflows/r10-live.yml`, `work/r10-live/check.mjs` and `work/r10-live/team-status.mjs`. No implementation branch was pushed.

The demo progressed from `bb5d6438789c88d9473551b61441493867c12744` to the intentional assertion failure `351ca9d1ff2facc369d6850fe43a227458c95f3d`, then the actual repair `f9d8b69e41d12ff5ebba044a5a5a2e4feb2e4090`. The delivery watcher automatically assigned repair to the original Backend member on GPT-6.1-Sol. Its first assignment responded to broader repository CI failure before the injected assertion reached CI; the running repair then removed that assertion. The Manager committed and pushed the correction through the authorized disposable branch. Both dedicated R10 checks recovered, and authenticated read-only re-review approved the exact repair SHA.

Broader repository CI remained failed/pending, so the live PR was never claimed fully ready. The actual card showed “Fixing CI” and its delivery timeline. One later redundant read-only attempt was blocked on snapshot verification; the valid earlier exact-head approval remains recorded. The native UI's cached pre-closure delivery state is distinct from the verified GitHub closed state.

PR #8 was **closed at 2026-10-07 22:41:04 UTC**, never merged. The branch and clean worktree were retained. Final native state had zero active workers; the isolated preview is idle.

Native screenshots: [PR delivery dark](../target/r10-pr-card-final-dark.png), [PR delivery light](../target/r10-pr-card-final-light.png), [working org dark](../target/r10-org-working-reviewed-dark.png), [working org light](../target/r10-org-working-reviewed-light.png), [read-only Reviewer dark](../target/r10-readonly-reviewer-working-dark.png), [read-only Reviewer light](../target/r10-readonly-reviewer-working-light.png).

Inspect the saved receipts in `target/r10-pr8-closed.json`, `target/r10-post-repair-authenticated-state.json`, `target/r10-final-idle-state.json`, and the full chronological observations in `target/r10-live-evidence.jsonl`. Final check logs are `target/r10-final-all-frontend.log`, `target/r10-final-all-host.log` and `target/r10-final-all-native.log`.
