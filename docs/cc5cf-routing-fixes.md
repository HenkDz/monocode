# CC5C-F: deterministic routing review fixes

CC5C-R found four routing defects: a second project's descendant file path disappeared from ambiguity checks; overlapping embedded/floating sends lost the first durable user origin; pending origins older than the ten-turn display page stopped recovering; and a rejected retry could send to Grand while showing a Manager chip. This round repairs those boundaries and preserves the existing user-only goal authority, Manager ownership, ledger receipts, cancellation and queue behavior.

The worktree began at `1147d9b` on `HenkDz/cc5cf-routing-fixes`. The required `git merge --no-ff HenkDz/cc5c-routing` merged `18f2424` without conflicts as `bb000ac`. Current CC5-D/F wake digests and CC7-P presentation changes remain in the combined tree. Source files retain LF endings; changes in App stay local to the route adapter and recovery poll.

## Changes and decisions

`monoGoalRouting.ts` distinguishes exact identities from descendant references. All registered roots contribute to ambiguity, including unavailable targets and Windows case/backslash variants. A descendant alone remains ineligible for automatic routing, and a nested path belongs to its most specific registered root.

`monoGoalUpdates.ts` serializes each originating session's complete read, change, save and ref update. The second sender computes its snapshot after the first sender publishes its saved origin. A failed update releases the queue; another session can proceed independently. Serializing only prebuilt database payloads was rejected because it reproduced the loss.

`monoGoalRecovery.ts` pages durable transcript history independently of the display. The App updater checks the full historical identity, repairs an existing pending card in place, and persists against that history's baseline. `sessionStore.ts` restores the live-page cache after a repair, and the App publishes visible blocks plus newly appended cards. Historical origins retain their IDs and position, including after a subsequent ordinary save. Missing anchors, duplicate IDs and nonadvancing cursors fail closed. A transcript read failure does not prevent the existing ledger recovery from proceeding.

The shared route UI accepts the retained route snapshot. Pending/uncertain acceptance keeps the original chip and envelope. Only an explicit false response allows recalculation; unchanged rejected routes reuse IDs, and changed routes receive new IDs. This stays self-contained for the upcoming upstream composer restructure.

Rejected alternatives: fuzzy/model routing, descendant-only authorization, rerouting uncertain requests, widening CLI grants, another scheduler/ledger, and a native pending-index/schema change. Existing page APIs provide the smallest complete recovery repair.

## Validation and evidence

Final validation results are recorded in the round report and the raw logs in `C:/Users/nooro/AppData/Local/Temp/monocode-cc/cc5cf/evidence/`. All Node checks use `NODE_OPTIONS=--no-experimental-webstorage`.

| Check | Result |
| --- | --- |
| Final full `npx --no-install vitest run --maxWorkers=4` | 580 files passed, 2 skipped, 0 failed; **6,797 tests passed, 13 skipped, 0 failed**, 6,810 total; 160.28 s tool / 162.022 s wall. |
| Matching focused suite | 1 file, **134 passed**, 0 skipped/failed. |
| Recovery/store/App-race focused suites | 4 files, **54 passed**, 0 skipped/failed. |
| Composer/route/IME/drop focused suites | 5 files, **33 passed**, 0 skipped/failed. |
| Origin queue and exact App race | 2 files, **3 passed**, 0 skipped/failed. |
| `npx --no-install tsc --noEmit` | Exit 0, no diagnostics; 39.773 s wall. |
| `npm run build` | Exit 0; Vite 38.57 s / 73.111 s wall; existing CSS/import/chunk warnings retained. |
| Playwright CC5-C browser spec | **8 passed**, 0 skipped/failed; Chromium/WebKit, embedded/floating, dark/light; 51.2 s tool / 53.620 s wall. |
| Preview exit audit / whitespace / line endings | Zero port-1435 listeners; empty launch folder; `git diff --check` passes; all changed files use LF. |
| Focused Cargo | Not applicable; no native changes. |

An earlier default-worker full run passed 6,796 tests before the final null-anchor case was added. The default-worker rerun on the final source failed 4 assertions in unchanged `FileEditorCrlfGit.test.ts` and `useQuickAttachments.test.ts` (6,793 passed, 13 skipped; 578 files passed, 2 failed, 2 skipped). All 17 cases in those files passed in isolation. The final full run limits worker concurrency and passes every non-skipped test; no assertions, timeouts or tests were weakened. Logs retain both failed and passed runs. Antigravity real/soak suites account for all 13 skips.

The committed regressions preserve the reviewer cases: matching tests include both Windows variants, Unix and unavailable projects; the race test executes the exact App updater with the real frontend write queue and a synthetic native suffix writer; recovery tests simulate ten newer Chat turns and execute that same App updater; composer retry tests use the actual submission adapter. Focused controls cover nested roots, pending rejection, uncertain durable acceptance, historical identity conflicts, later saves and initially empty transcript anchors.

Before evidence: `matching-before.log` (6 failed assertions), `race-before.log` (1 failed durable-origin assertion), `composer-retry-before.log` (3 failed route invariants), `pending-origin-pagination.json` (one stored origin, zero in the restart page), and `pending-origin-recovery-old-store.log` (2 duplicate-ID failures). After evidence: `matching-after.log`, `race-integrated.log`, `composer-retry-after.log`, and `pending-origin-recovery-after.log`.

The browser harness uses an isolated empty launch folder, cleaned `CODEX_HOME`/`ORCA_*`, synthetic project identities and temporary browser profiles. `playwright.log` and `browser-results/` retain Chromium/WebKit, embedded/floating and dark/light checks plus sixteen screenshots. Embedded dark Auto and floating light explicit selection were inspected. No native source changed, so focused Cargo is not applicable.

## Limits and follow-ups

Recovery scans the full saved history; very long conversations can make polling slower. Add a durable pending index if measured recovery cost warrants it. The baseline ledger recovery can still stop at its first failed receipt; that separate starvation issue remains outside these four fixes.

The new serialization covers routed origin/card/pending updates. The tests also cover a subsequent ordinary save; concurrent ordinary autosave snapshots during native persistence remain outside the verified boundary.

Native desktop/floating-window acceptance, live provider turns and production latency were not exercised. The tests establish frontend persistence/routing and synthetic SQL behavior. No real user data, other worktree, push, merge into `nour`, deployment, dependency migration or upstream integration was performed.
