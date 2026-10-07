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
