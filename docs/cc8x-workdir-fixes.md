# CC8X: working-folder migration crash and junction fixes

Branch: `HenkDz/cc8x-workdir-fixes`, based on
`7cc1648927704200fe4c3618fb1498061a4ed304`.
Integration and publication remain coordinator-owned.

The CC8WR ship review found two gaps in CC8W: accepting a relocated turn could
clear recovery before its fork ID reached the database, and loading identity
files could write through a junction before workspace validation rejected it.

## Durable native binding before submission

App's existing `prepareText` callback now awaits the confirmed provider ID's
save through the existing per-session writer before the provider submits the
relocated turn. Rejected saves and null results stop submission. The writer
constructs the save from current session state, preserving concurrent profile,
transcript-page and queue changes. The receipt still clears on acceptance.
The binding callback checks the turn's harness and account both when the writer
constructs its snapshot and when it publishes the completed save. Switching
providers during the save stops that turn and keeps the user's changed choice.

The gate tests whether a receipt remains pending, independently of the current
in-memory native ID. This matters after a failed save: an event may already
have published the fork ID while the database retains the old one. Pi/OMP also
reject a fork that supplies no native ID, before issuing a prompt.

No provider interface, database schema or replacement writer was introduced.
Flushing events alone and clearing recovery after a post-acceptance save were
rejected because they still allow an accepted fork to become unreachable after
a crash. Saving only when the old ID matches memory was rejected because it
misses the failed-save retry. Treating an unreadable receipt as absent was also
rejected: read uncertainty must stop submission before an unsaved fork accepts.

## Validation before identity writes

Native Mono preparation validates existing app-data, monos, ID, memory and
workspace components before initialization. Controlled identity/topic files,
atomic temporary files, legacy roots, index files and adoption source/destination
paths reject symlinks and Windows reparse points. Directory checks are read-only
until all existing components on the preparation path have passed. Legacy
adoption still precedes creating a missing ID folder; scratch contents are kept.

Moving workspace creation before loading identity was rejected because it
would prevent legacy adoption. The existing file mutex and directory validation
are reused; arbitrary scratch contents are not scanned.

## Reproduction and focused validation

- Ported provider acceptance/crash reproduction: **17 cases**. Baseline App:
  **6 passed, 11 failed, 0 skipped**, **6.59 s**. Fixed App: **17 passed,
  0 failed/skipped**, **7.24 s**. Both queued binding and pending ordinary-save
  crash windows are covered for forked and retained IDs.
- Final review added one receipt-read-failure case: before **17 passed,
  1 failed**, after **18 passed, 0 failed/skipped**; command durations
  **5.213 s** and **5.321 s**.
- Provider/account changes during binding persistence: before **18 passed,
  2 failed**, final **20 passed, 0 failed/skipped**, command durations
  **6.863 s** and **5.860 s**. An intermediate assertion wrongly required
  explicit undefined fields in the sanitized payload; its two failures are
  retained in `provider-switch-after.*`. Direct field checks fixed the fixture.
- Pi/OMP missing fork ID: before **56 passed, 2 failed**, after **58 passed,
  0 failed/skipped** in the adapter file. Command durations **10.506 s** and
  **11.099 s** respectively.
- Complete native preparation: before **0 passed, 1 failed, 739 filtered**,
  **24.060 s** command. All five link positions initialized identity; the
  app-data/monos/ID junction targets gained **1/1/3 entries**.
- `cargo test --lib mono::tests -- --nocapture`: **14 passed, 0 failed/ignored,
  730 filtered**, **0.89 s** tests, **54.101 s** command. All five preparation
  targets stay empty. Additional fixtures cover eight file/temp leaves, six
  legacy source/destination/index paths, four legacy-root paths and normal
  root/ID adoption.
- Touched `mono.rs` formatting and `git diff --check` pass.

Windows, Node `v26.5.0`; all web checks use process-local
`NODE_OPTIONS=--no-experimental-webstorage`, synthetic profile/cache paths,
and unset `CODEX_HOME` and `ORCA_*` variables:

- Final full `npx vitest run --maxWorkers=1`: **7,436 passed, 13 skipped,
  0 failed**, **612 passed and 2 skipped files** (7,449 tests / 614 files),
  **449.003 s** command / **445.85 s** Vitest. No unhandled errors reported.
  The 13 skips are the existing Antigravity real/soak fixtures.
- Final-source `npx tsc --noEmit`: **exit 0**, **29.316 s**.
- Final-source `npm run build`: **exit 0**, **57.540 s**. CSS highlight,
  mixed `mono.ts` imports and chunk-size warnings remain.
- The first final-source full run at four workers had **7,433 passed,
  3 failed, 13 skipped**; **611 passed, 1 failed, 2 skipped files**,
  **186.023 s** command. All 20 new migration tests passed. The unchanged CRLF
  editor file had two five-second timeouts and one subsequent mount failure.
- The CRLF editor file passes alone: **4 passed, 0 failed/skipped**, **7.132 s**
  command. Its test, `FileEditor.tsx` and `editorGit.ts` have identical blobs at
  the base and this checkout; `src/features/files` has no diff. The full-suite
  failure remains recorded, without a source, skip or timeout change.
- The two-worker retry also failed the same three editor cases: **7,433 passed,
  3 failed, 13 skipped**, **611 passed, 1 failed, 2 skipped files**,
  **380.713 s** command. The serial run uses the unchanged repository config;
  its editor file passes all four cases. Parallel timing stability remains a
  follow-up, and its underlying cause was not established.

Evidence root: `C:/Users/nooro/AppData/Local/Temp/monocode-cc/cc8x/evidence/`.
`p1-before/after-results.json`, `p1-before/after.log`, `p1-regression-notes.md`,
`pi-unknown-before-isolated.*`, `pi-unknown-after.*`, `native-before/after.*`,
`receipt-read-before/after.*`, `provider-switch-before/after/final.*` and
`native-summary.json` retain the reproductions and results. The P1 baseline
uses read-only `git show` App source substituted by an evidence-only fixture;
the checkout is never switched. The native baseline includes only a helper
extraction to test the original root resolution without a live Tauri handle.
`web-validation-summary.json`, `vitest-full*`, `tsc*` and `web-build*` contain
the final checks. `web-final-failed/` and `web-final-failed-two/` preserve failed
parallel runs; `crlf-base-proof.json`, `crlf-run-comparison.json` and
`serial-runtime-proof.json` record the unchanged files, timing comparison and
single-worker proof. `web-initial/` and `web-before-identity-guard/` retain the
earlier successful/interrupted checks and their scope.

## Limits and deliberately omitted work

Provider crash checks use real App/writer/event/resume code with a synthetic
native store. Native path checks use real Windows junctions in synthetic Temp
folders. No installed provider, real database crash, native preview, live model
turn or OS folder picker was exercised. External-drive sandbox acceptance
remains outside this round. Existing components are validated under the trusted
platform app-data root; external processes racing filesystem replacement are
outside this guard's guarantee.

No real profile, account, ACL, permission policy, dependency, coordinator board
or other worktree was changed. No push, merge, rebase or deployment was done.
