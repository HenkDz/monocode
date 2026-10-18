# R24: shared GitHub API budget

R24 starts from `0995ea2258698975225d1c26f42f0288f2624fa2` on the local branch `HenkDz/r24-github-budget`. No branch was pushed and no PR, merge, deployment, or real project checkout was changed.

## Measurement before optimization

The initial source inspection happened before gateway edits. Native `fs.rs` already centralized app GitHub commands in `gh_run`, but cached no successful responses. The host used independent `gh` executions. R19's session hook refreshed every retained URL, including merged and closed PRs, every 30 seconds. A URL lookup fetched repository identity and PR data separately. Worktree listing fetched one list per current/historical branch, with up to 20 historical branches. Inbox, Checks, and delivery watching fetched independently. Ambiguous check identities could add paginated REST reads per head.

The reproducible ten-minute fixture has 75 distinct PRs shared across four worktrees, 60 terminal and 15 open, and ticks at 0 through 570 seconds. Each worktree has its current branch plus 20 historical branches. It includes Inbox issue/PR reads every two minutes, one visible Checks pane, and one delivery watch. Initial loads count; no focus churn or ambiguous-app enrichment is added. Initial baseline counts were derived from the original source before edits. `scripts/r24-github-baseline.cjs` then independently replays the immutable backend from `0995ea2` with mocked Git/GitHub executors: **3,000 session + 1,760 list + 20 delivery-status = 4,780 observed command invocations**. The remaining **50 Inbox/check-detail invocations are modeled** from their original call shapes. `host/github-gateway.test.ts` executes the optimized gateway with a mocked executor and clock. Neither side is a live ten-minute recording or a claim about HTTP requests inside `gh`.

| Consumer / gateway path | Before: replayed/modeled `gh` calls | After: mocked executor calls |
| --- | ---: | ---: |
| Session PR URLs | 3,000 | Shared summary cache |
| Worktree/sidebar PR listing | 1,760 | 44 batched queries |
| Shared repository identity | Included above | 4 |
| Inbox issue/PR lists | 10 | 10 |
| Visible Checks pane | 20 | 10 REST refreshes |
| Delivery watch | 40 | Shared summary/check cache |
| **Total per ten minutes** | **4,830** | **68** |

This fixture reduces executor calls by **71.03x (98.59%)**. Its response fixtures inject one GraphQL point or REST request unit per executed command, producing **4,830 modeled units before / 68 observed fixture units after**. These are deliberately synthetic costs, not measured GitHub GraphQL points. Nested connections, pagination, and CLI-internal requests can change real query cost. A separate 75-PR batching/coalescing test proves one query for concurrent identical summaries across worktrees, cache hits, and no terminal-PR revalidation during the interval. Conditional ETag/304 behavior is tested separately; the workload's mock REST responses do not carry real ETags.

## Bounded live sample

One read of `/rate_limit` reported GraphQL 4,823/5,000, REST core 5,000/5,000 and search 30/30 remaining. Two bounded GraphQL data attempts failed with the reported user's exhaustion error; the intended batch sample was never executed. No successful data-query cost was returned. All subsequent measurement used mocks. This demonstrates why the data endpoint's exhaustion response must override a previous quota snapshot. **Live before/after GraphQL points and the live 5x target remain unverified.** No live polling or ten-minute live workload was run.

## Runtime behavior

- Native app commands go through `github_gateway.rs`; host commands go through `host/github-gateway.ts`. Each runtime has one shared gateway rather than a cache per view/worktree. The UI routes budget reads through the active local/remote workspace and ignores late responses from a previous workspace. GitHub traffic from external agents or other applications remains outside these process caches.
- GraphQL summary batches contain multiple PR numbers/heads and `rateLimit { cost remaining limit resetAt }`. Latest check identity/grouping is preserved; incomplete data does not become a successful check result. Detailed checks are requested when opening the Checks tab.
- Reads coalesce while in flight and cache for 60 seconds. Terminal snapshots and historical discovery use a 24-hour lifetime; subsequent discovery requests only open PRs and previously open identities to observe closure. Repo/PR identities are shared across worktrees. Mutations are never cached or reported as successful from stale data and invalidate cached reads.
- REST requests use ETags and `If-None-Match` where supported, retaining data on a 304. Budget observation reads REST response headers and GraphQL rate metadata. The read-only `github_api_budget` command exposes remaining/limit/reset/resource/status and per-path call/cost counters without making a GitHub request. Call counters count executor invocations; costs count observed metadata/request units and can be incomplete for CLI-internal GraphQL calls.
- Low budget pauses shared reads near 10%; exhaustion pauses requests until the known reset. Unknown primary resets use a conservative one-hour fallback pause; secondary throttles use a one-minute backoff. A later response for another resource cannot clear an active exhaustion pause. Hidden windows stop automatic PR/checks/delivery polls; Inbox retains its upstream five-minute hidden backoff. Session tracking and delivery watching stop polling terminal PRs.
- Rate-limit failures retain last-known data and use the quiet reset-time notice. GitHub refresh, repair, and PR actions are disabled while exhausted or while low-budget reads are paused, with an explanatory tooltip. A low-budget tooltip says updates are paused rather than claiming exhaustion. Settings > Inbox displays the remaining budget and reset. HTTP debug output stays internal; the raw user-ID error is not shown.
- Org and worker prompts ask agents to select only required `gh pr view --json` fields, avoid polling loops, poll no faster than 60 seconds, and stop when the app reports a low/exhausted budget. Prompts guide external agents; they cannot enforce a shared quota across independent `gh` processes or other apps.

## Reproduction

Use `NODE_OPTIONS=--no-experimental-webstorage` with Node 26 for happy-dom tests. The fixture needs no credentials or network access:

```text
node scripts/r24-github-baseline.cjs
npx vitest run --config host/vitest.config.ts host/github-gateway.test.ts
npx vitest run --maxWorkers=8 --testTimeout=15000 --hookTimeout=15000
npx tsc --noEmit
npm run build
npx vitest run --config host/vitest.config.ts --maxWorkers=4
npm run host:build
cargo test --lib --no-default-features github
cargo test --lib --no-default-features pr_
```

Final validation: frontend **5,672 passed / 13 skipped**; host **136 passed / 12 skipped**; TypeScript, frontend production build, and host build passed. Native **42 GitHub tests** and **30 PR tests** passed (filters overlap); the final **six gateway tests** also passed after the last native edits. `git diff --check` passed. Earlier concurrent runs hit an existing CRLF Git test's default timeout and a host Windows temp-cleanup `EPERM`; both passed in isolation, and the final full runs passed with the worker/timeout settings above. No unrelated test source was changed to resolve those failures. Production build emitted the existing chunk-size/dynamic-import warnings.

No preview was launched against a real checkout. Budget UI behavior is verified with mounted mocked components; live app rendering and live quota savings are separate from fixture evidence.
