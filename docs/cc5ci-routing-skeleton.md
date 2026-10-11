# CC5C-I: canonical routing and uncertain-write reconciliation

CC5CHR found two remaining routing defects: invisible/Unicode/markup spelling could hide a second registered project, and ordinary Chat persistence could erase an origin whose durable save acknowledgement failed before App publication. CC5CI corrects both in the existing shared resolver and session writer boundary.

## Routing

Both goal text and registered project names undergo NFKC normalization, case folding (including sharp s), then NFD with every combining mark removed. Exact positive matching keeps its existing token boundaries. The separate conservative conflict check strips every character outside `[a-z0-9]` and treats any other registered name's skeleton as a conflict, including unavailable Managers and empty skeletons.

Auto routes no text with letters still outside ASCII after folding. Non-English prose therefore needs an explicit chip when its letters remain outside ASCII; the skeleton conflict check still applies. An explicit chip can select a project for separate non-English prose, but mixed ASCII/non-ASCII letter tokens remain Grand because they can hide a project name using homoglyphs. Tags/comments, HTML entities and Markdown links also remain Grand for both selection modes. A literal ASCII skeleton does not remove the letters in tag/comment/link payloads, so refusing markup closes the original reproductions without introducing a parser. No confusables table, fuzzy matching, model turn or dependency was added.

`monoGoalRoutingCanonical.test.ts` ports all 62 reviewer resolver inputs and eight connected Composer/SearchableSelect/adapter/ledger cases, including the original 47 unsafe failures. It adds normalization controls, empty-folded-name protection, mixed-token/non-English chip rules, 1,536 seeded two-project variants with invisibles, markup, line breaks and Auto homoglyph substitutions, and the unchanged 20-goal sample with a minimum of 14 Auto routes. The sample retains 16/20 Auto routes.

## Persistence and Chat

The App updater registers a pending reconciliation inside `writeSession` before propagating a failed goal save. Every later session writer attempts that reconciliation before constructing its snapshot. Readback validates the original origin through `appendMonoGoalOrigin`, merges durable origins with the current writable tail, publishes the result, and replaces the uncertain cache baseline with a valid durable anchor. The guard remains if history or identity cannot be checked. A proven missing origin releases it without inventing one. Successful session deletion removes retained callbacks.

Chat initiates reconciliation and returns `false` while the guard is present. Its draft stays in both embedded and floating composers, and storage preparation/provider submission does not begin. The user retries Chat after the check finishes. This keeps the existing synchronous ordinary composer contract and avoids accepting a draft whose later reconciliation fails. Persistence may reconcile automatically before that retry.

The connected tests reproduce the reviewer's ordinary-save-before-retry order on both surfaces. Additional cases cover unreadable history, retained Chat drafts and zero provider work, a real cached-empty baseline, earlier durable history outside that empty tail, and a deleted draft anchor. Cache invalidation occurs with a known durable suffix anchor so the next save neither appends the same origin twice nor replaces earlier history. The storage-repair extraction fixture receives the new real submission-guard dependency.

## Validation and evidence

Windows, Node 26.5.0, npm 11.17.0, Vitest 3.2.7, TypeScript 5.8.3 and Playwright 1.63.0. All Node checks use `NODE_OPTIONS=--no-experimental-webstorage`; no native implementation changed.

The final focused suite passed **331 tests in eight files**, zero failed/skipped, in **9.54 seconds**. It includes 92 canonical routing cases and 22 connected retry/writer/Chat cases.

| Check | Final result |
| --- | --- |
| Full `npx --no-install vitest run --maxWorkers=1` | **7,397 passed, 13 skipped, zero failed; 7,410 total. 607 files passed, two skipped, zero failed; 609 total.** Tool 822.13 s; wall 824.678 s. |
| Focused eight-file suite | **331 passed**, zero failed/skipped; 9.54 s. |
| `npx --no-install tsc --noEmit` | Exit 0, zero diagnostics; wall 42.073 s. |
| `npm run build` | Exit 0; Vite 42.58 s; wall 85.311 s. |
| `npx --no-install playwright test tests/browser/cc5c-routing.spec.ts`, isolated external config | **Eight passed**, zero skipped/failed/flaky; 24 screenshots; tool 62.915 s; wall 66.240 s. |
| Previously failing editor files, isolated unchanged | **13 passed in two files**, zero failed/skipped; tool 15.20 s; wall 18.008 s. |
| Existing lockfile `npm ci` | Exit 0; wall 37.273 s; no dependency edits. |
| Final source audit | **1,598 source/test/package/config hashes unchanged** across the final checks; documentation excluded. |
| Native/Cargo checks | Not applicable: no native changes. |

A completed concurrent four-worker attempt had 7,385 passes, 13 skips and 12 editor UI failures from timeouts and missing-editor cascades; a two-worker attempt also timed out and was stopped. Both editor files then passed unchanged in the final one-worker full run. No assertion or timeout was weakened. An earlier pre-correction run was interrupted and is not counted as completed validation. Counts overlap and are not additive; timings reflect shared-host contention, not production performance. The 13 skips are existing Antigravity real/soak tests. The build retains existing CSS/import/chunk warnings.

The browser harness used Chromium/WebKit, embedded/floating layouts, dark/light themes, synthetic IPC/projects and an initially empty launch folder with identifier `com.monocode.cc5ci.validation` and port 1459. `CODEX_HOME` and every `ORCA_*` variable were removed from its environment. Final cleanup found zero listeners and zero owned preview processes. Representative conflict screenshots show Grand as the actual destination while retaining the explicit project selection.

Evidence: `C:/Users/nooro/AppData/Local/Temp/monocode-cc/cc5ci/evidence/`. `focused.log` and `run-focused.ps1` record the focused regression suite. The `validation/` folder holds required-suite logs, JSON results, exact source hash audits, browser screenshots and owned-preview cleanup receipts. Original failing inputs and expected safe behavior came from `C:/Users/nooro/AppData/Local/Temp/monocode-cc/cc5chr/evidence/adversarial/normalization.test.ts` and `evidence/writers/adjacent-retry-writer.test.ts`.

## Limits and decisions

Kept the single ledger/outbox, original request/Manager identity, user-only New goal authority, strict path fallback, archive/Resume behavior and publishing/merge rules. Rejected alternatives were a markup parser, a confusables database, a second goal store, automatic rerouting to Grand after uncertainty, broad asynchronous composer changes, and silently accepting Chat before readback.

The guard is session-scoped and in memory; restart recovery still uses the existing full-history origin scan. Active App and lifecycle writers select live state inside the boundary. This does not promise preservation for an arbitrary external caller saving a frozen snapshot that omits durable data. Synthetic native faults and browser IPC establish source/fixture behavior; live native fault injection, provider execution and shipped acceptance remain unmeasured. Inherited full-history scan costs and receipt recovery ordering remain follow-ups.

No real user data, BOARD, other worktree or branch was modified. No native preview, model turn, dependency migration, merge, rebase, push, deployment or shipping was performed.
