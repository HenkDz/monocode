# CC5-C: deterministic project goal routing

An explicit New goal submission to Grand Orchestrator can now go straight to a project's Manager. The composer displays `Send to <project> Manager`, its exact-match reason, and a searchable Grand/Manager override before Send. Chat is the default, and an accepted Send resets the intent to Chat. Both the embedded and floating composer use the same App adapter before Grand storage preparation or provider submission.

This implements section 2 of `docs/cc2-orchestration-design.md`. The baseline recorded a 359-second Grand routing turn with 22 model calls. CC5-C removes that Grand turn for eligible goals; the controlled tests establish zero Grand submissions, rather than a measured production latency improvement.

## Matching and authority

`monoGoalRouting.ts` automatically routes only an exact, unique registered project name with token boundaries, no conflicting registered project name and no filesystem paths or path-like tokens. Positive names match without case sensitivity. Conflict detection independently lowercases the text and every registered name, removes Unicode punctuation and whitespace, and blocks the Manager if the normalized text contains any other project's normalized name as a substring. Unavailable and archived Manager identities remain in this scan. The same conflict rule applies to explicitly selected project chips and shows the conflict before Send.

This deliberately over-blocks: `Fix Atlas and Beacon.`, `Fix Atlas. Update Beacon` and `Fix Atlas... and Beacon` go to Grand. Short common-word names such as `Go` can match `goals`; overlapping names such as `Atlas` and `Atlas API`, names split by punctuation/whitespace, names inside paths, duplicate normalized names and punctuation-only names can also prevent routing to a Manager. These conservative Grand fallbacks are the accepted tradeoff for avoiding cross-project misrouting. Positive exact-name matching retains its existing safe false negatives, including a project name immediately followed by a period.

Any slash/backslash path, Windows drive prefix, dotted filename, dotfile or standalone `.`/`..` token sends automatic routing to Grand, including registered roots, relative paths, UNC/Unix paths, junction aliases, nested junctions and dot segments. Registered-root and descendant containment matching was removed. An explicit project chip can route a path-bearing goal and displays `Contains file paths: routed to <project> because you selected it`; textual project conflicts, cross-project wording and Manager availability checks still apply. Path-like prose is deliberately conservative: the user can select a chip when they intend one project.

A selected project can route a goal without a textual mention. Multiple matches, comparisons/cross-project wording, missing/archived/remote/unregistered Managers, a Grand override, Chat mode, attachments, empty goals and goals longer than 8,000 characters retain the full Grand submission path. New goal mode is the explicit user intent; the implementation does not classify prose as work or ordinary questions. Matching is conservative and deterministic, with no fuzzy matching, embeddings or model calls.

The adapter rechecks the current roster, direct reporting relationship and registration, resolves repository roots through the existing `validManagerProjects` host, and binds the Manager Mono identity and engine. It invokes `MonoManagerGoals.handle` with the actual Grand owner, durable user-message ID and a stable request ID. The ledger still owns scope, `mayDelegate`, receipt signatures and persistence before Manager delivery. CLI fields, active-turn grants, publishing authority and human-only merge rules are unchanged. Reports, tool output, team messages, habits and drafts cannot acquire new-goal authority through persisted route metadata.

## Delivery and recovery

The original user message is durable before the goal mutation. The session store's per-session write boundary covers origin/card updates, ordinary persistence, immediate queue/new-turn saves, deferred autosave, load repair and lifecycle saves. Each live writer selects current state inside that boundary; goal updates also publish their saved change before the next writer selects its snapshot. Optional goal metadata records its source message, canonical project, Manager engine/Mono, match reason and override. The existing assignment receipt/outbox delivers one stable message to the Manager's normal queue, including a busy Manager. Existing CC4 selectors continue to expose the Manager's queued/storage/approval state.

Routed outbox failures mark the goal blocked and retain the same receipt. Reconciliation preserves that blocked assignment until delivery succeeds. Cancellation holds an undelivered assignment behind a pending cancel; after cancellation succeeds, recovery retires the old assignment without execution and retains its history.

Once the user origin is durable, later failures are accepted as retained work rather than presented as a freely reroutable unsent draft. A blocked route card records the failure even when the goal mutation could not yet persist. Recovery uses that original envelope, fills the real goal/card when possible, and never falls back to Grand. A failed card save after durable ledger acceptance also cannot cause a second submission. Repeated sends/reloads preserve one goal, receipt and route card; changed request arguments are rejected. Embedded and floating composers share accepted/rejected/uncertain handling. While acceptance is pending or uncertain, the chip displays the retained envelope's route and retries keep its IDs. Before an unavailable retained Manager route can be rejected, App checks its original identity in durable history inside the session write boundary, including saves whose acknowledgement failed before App publication. An unreadable store retains the original chip and draft with `Checking previous send… Retry original when storage is available.` A proven absence returns rejection and refreshes the chip before a fresh Send; that retry never calls Grand under the previous Manager chip. A changed route gets fresh IDs, while an unchanged rejected route reuses its IDs. Explicit user edits create a new submission.

Project archival applies `archiveMonoConversation` to current state inside the same write boundary after cancellation settles. A Manager goal receipt acknowledged during cancellation stays queued and paused through archive/restore until explicit Resume. Origin reconciliation also retains unpublished durable goal origins in the writable tail and publishes them with its repaired card, so subsequent ordinary saves preserve them; older origins stay outside the displayed page.

`sessionStore.ts` validates and roundtrips the new user-block envelope through both ordinary and Mono transcript storage. Native blocks already store JSON values, so no database or Rust schema change was required. Pending origins/card gaps reuse the existing 25-second Manager recovery poll. Recovery reads all durable transcript pages independently of the viewer, checks historical origin/card identities, and saves repairs against a full-history baseline. It restores the live-page write cache and publishes only visible or newly appended blocks, preventing a later ordinary save from deleting history. Cursor, anchor and duplicate-ID failures stop that repair; a failed transcript scan leaves the separate ledger recovery running. No scheduler, event bus or alternate goal store was added.

## Validation and evidence

The table below records the original CC5-C build. [CC5C-F routing fixes](cc5cf-routing-fixes.md) records the first correction round. [CC5C-G routing simplification](cc5cg-routing-simplify.md) records the path fallback rule, unified persistence boundary and floating acknowledgement correction. [CC5CH conservative routing](cc5ch-routing-conservative.md) records the final conflict rule, archival and unpublished-origin retry corrections, and their validation.

All Node checks used `NODE_OPTIONS=--no-experimental-webstorage` on Windows. A normal local `npm ci` installed the existing lockfile without dependency edits or force flags.

| Check | Final result |
| --- | --- |
| `npx --no-install vitest run` | 571 files passed, 2 skipped, 0 failed; **6,619 tests passed, 13 skipped, 0 failed**. Vitest 37.20 s; wall 38.768 s. |
| Routing/ledger/bridge/composer/persistence subset of that full run | 7 files, **239 tests passed**, 0 failed/skipped; includes 100 eligible goal fixtures with zero Grand submissions. |
| `npx --no-install tsc --noEmit` | Exit 0, no diagnostics; wall 14.205 s. |
| `npm run build` | Exit 0; Vite 20.33 s; wall 48.947 s. |
| Playwright CC5-C harness | **8 tests passed**, 0 failed/skipped; 32.8 s; Chromium/WebKit, embedded/floating widths, dark/light, overrides and submission. |
| `git diff --check` | Passed. |
| Focused Cargo | Not applicable: no native changes. |

Evidence lives in `C:/Users/nooro/AppData/Local/Temp/monocode-cc/cc5c/evidence/`: `full.log`, `full-initial.log`, `focused.log`, `tsc.log`, `build.log`, `browser-final.log`, `ledger-focused-tests.md` and `ui/`. The initial full run passed 6,612 tests; final counts include the later cancellation, retry and persistence regressions. Existing Antigravity real/soak suites account for the 13 skipped tests. Test logs retain existing mocked-native/React warnings; build retains CSS, import/chunk-size warnings.

The harness uses synthetic candidates, temporary browser storage and mocked native calls. It clears `CODEX_HOME` and `ORCA_*`; its owned preview exits with Playwright. Sixteen screenshots capture Auto and explicit Manager selection in both engines/surfaces/themes. The builder inspected embedded dark Auto and floating light explicit selection:

![Embedded route chip](C:/Users/nooro/AppData/Local/Temp/monocode-cc/cc5c/evidence/ui/chromium-embedded-dark-auto.png)

![Floating route chip](C:/Users/nooro/AppData/Local/Temp/monocode-cc/cc5c/evidence/ui/webkit-floating-light-override.png)

## Scope and limits

Rejected alternatives were model/fuzzy routing, inferring task intent from ordinary chat, fake CLI grants, a second goal ledger, automatic reassignment, and broadening unrelated Composer/draft callbacks to asynchronous contracts. Only Mono goal submissions use the new async callback; ordinary submissions retain their existing contract.

No live model turn, production profile modification, native preview, push, merge, deployment, wake-digest edit, dependency migration or fuzzy routing was performed. The browser harness demonstrates the shared composer at floating width; it is not a native macOS floating-window acceptance test. Actual receipt-to-target p50/p95 and the design's <=10-second live target remain unmeasured because this brief does not authorize live model turns. Long/busy/resource-blocked Manager waits retain normal queue and CC4 behavior. After dispatch, cancellation/reassignment continues through existing explicit goal controls and retains worktrees/history.
