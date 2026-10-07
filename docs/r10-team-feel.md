# R10 team feel

Roles guide coordination. Teammates can ask each other directly, with messages in the Manager's crew feed. Cross-team questions route through the recipient's Manager, and repeated exchanges on a topic suggest involving the Manager. Messages retain event authority through queued delivery.

Review remains the default for code changes. A Manager can mark a change trivial, with an explicit “Not reviewed (trivial)” label. Retiring the last Reviewer leaves a visible warning. Agent merges, destructive operations without the user, identity spoofing, and unsafe permission elevation remain protected.

The Activity panel shows the org hierarchy, current tasks, worker activity and elapsed time. Crew events come from persisted assignments, results, reviews, hand-offs, PRs and user decisions. Member headers use the same task availability as the sidebar. Team worker sessions, including read-only sessions and retained dispatches, do not contribute to “Your worktrees”.

PR delivery watches commit, CI and conflict evidence in the background. Repairs return to the original task and retained checkout. New commits make approval outdated and request fresh review. Hand-off notes and recent project summaries accompany continuing work; the existing member memory is retained.

New session and Mono defaults remain `codex:gpt-5.6-sol`.

## Verification

- Full frontend: 5,221 passed, 13 skipped, including the full 97-test orchestration file, active-worker teammate routing and Codex code-mode activity.
- Host: 95 passed, 12 platform skips.
- TypeScript and production/native builds pass.
- Native: 538 passed, 1 ignored, 1 environment-dependent failure in `mcp::tests::discovers_provider_configs_without_exposing_credentials`, caused by actual global MCP configurations being discovered alongside its fixture. Relevant control CLI and PR metadata tests pass.
- Independent policy, UI and delivery integration review completed.

The live exercise exposed the native worker allowlist missing `team.message`, which was corrected with scoped grant tests. The initial Orchestrator Auto turn also encountered Windows sandbox initialization failures; only the isolated preview was changed to Full access and continued. Codex code-mode custom tools now opt into raw tool events for new threads. The installed provider's resume schema does not document this flag, so raw activity for older resumed threads remains provider-dependent; normal command and MCP activity continues to work.

Isolated live acceptance evidence is recorded below when complete. The implementation branch is local only. Any disposable test PR is closed after capture and never merged.
