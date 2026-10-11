# Codex storage conflicts (R27)

Local branch: `HenkDz/r27-storage-repair`, based on `de8edc3b389c3362134cc5a521458b241496b4c2`. This patch does not authorize a push, merge, or deployment.

Atomic replacement of an account file detaches its Windows hardlink in Mono storage. The old copy becomes a lone real file, so preparation reports a conflict and Repair repeats the same failure. This affects hooks, instructions, and configuration rewritten through temp-file rename.

## Patch

- Prefer file symlinks, with hardlink fallback. Record shared-content SHA-256 snapshots in `.monocode-links/`. A detached file heals only when it matches the account version, its recorded snapshot, or the exact empty hooks object. Archive its bytes under `.monocode-conflicts/<timestamp>-<uuid>/` before relinking. Preserve existing untracked private config overrides.
- Return structured conflict metadata inside the existing storage-error envelope. Native resolution offers the account version or a durable private Mono version, plus bounded comparison and folder reveal. Derive paths from the selected account, reject stale fingerprints and Windows path/state aliases, and keep credentials shared. Config and login contents are excluded from comparison.
- Preserve bytes on failed publication and concurrent file recreation. Require real metadata/backup directories. A deleted private override returns to account sharing on preparation.
- Group Inbox issues by account and show one compact card per blocked conversation. Offer version choices, Compare, Show in folder, and collapsed copyable details. Member status says `Blocked · storage`; held messages say `Waiting for storage repair`.
- Coalesce account repair, wait for in-flight preparations, retain the original account, and resume held submissions after resolution. Durable queues respect edits and cancellation; failed restarts retain their retry action. Show brief success feedback.

## Reproduction

Use synthetic temporary homes. Create a real hardlink, record its shared snapshot, then replace the account file through temp-file rename. Confirm that the Mono file retains the old bytes with one remaining link. Prepare again and verify the byte-identical archive and current account link. Repeat for `hooks.json`, `AGENTS.md`, and `config.toml`; also verify divergent-file choices, private overrides, stale requests, busy files, concurrent recreation, and credential/state aliases. A file-symlink fixture follows source replacement immediately.

## CC0F review fixes

CC0F builds on CC0 through a local merge in `HenkDz/cc0f-storage-fixes`. The independent CC0R review reproduced five defects despite the original validation passing.

- Classify the actual Windows directory entry before resolve, compare, or reveal. Real NTFS short names cannot bypass credential or private SQLite rules.
- Claim an entry before replacing it or judging its recovery eligibility. On Windows, operate on the entry's own handle and deny concurrent writes/replacements while verifying it. Publish with no-overwrite semantics; preserve and report an entry created by another writer.
- Recheck the claimed bytes for automatic recovery and both explicit choices. Rejected objects are restored safely; committed conflict archives hold independent real bytes, never symlinks.
- Clear each live account member's storage error immediately before its held submission replays. A conversation joining during relinking or an earlier replay participates in the same repair and cleanup.
- Preserve corrupt snapshot metadata and require a fresh explicit conflict choice, including on subsequent retries. Keep a returned conflict available while Compare or Show in folder clears transient action errors.

The committed regressions use synchronized external writers, actual NTFS aliases, the real App callback and submission preflight, and rendered notice actions. All fixtures use synthetic temporary homes. Account hooks sharing remains unchanged. A future per-entry isolate policy belongs in `prepare_files` before shared-entry reconciliation; `autoheal_allowed` holds the existing empty-hooks exception.

## Original CC0 validation

**38 focused Windows native tests passed**, with zero failures or ignored tests. The full frontend suite passed **5,993 tests**, with 13 existing Antigravity real-provider/soak tests skipped and zero failures. `tsc --noEmit`, `npm run build`, `cargo fmt --all -- --check`, and `git diff --check` passed. Frontend commands used `NODE_OPTIONS=--no-experimental-webstorage`; existing CSS/chunk warnings remain.

Evidence is retained under `C:/Users/nooro/AppData/Local/Temp/r27-storage-repair/`: `REPORT.md`, `native-tests.log`, `vitest.json`, and frontend validation logs/receipts. No real-profile repair, native GUI acceptance, preview, or model turn was attempted. Hardlink fallback reconciles on preparation; real directory conflicts remain preserved and fail closed. Backups have no automatic pruning.

## CC0F validation

The final frontend suite passed **5,999 tests**, skipped **13 existing Antigravity real-provider/soak tests**, and failed **0** across **547 passed and 2 skipped files**. TypeScript and the production build passed. The focused frontend run passed **28 tests**. The focused Windows product suite passed **46 native storage tests**, with **0 failures or ignored tests** and **608 filtered tests**. Only the touched Rust file was formatted and checked.

Before the fixes, the six ported native reproductions all failed, and the App/UI regressions had four failures. These logs are retained. An initial final full frontend run hit two unchanged file-editor test timeouts under overlapping validation load; those four file-editor tests passed in isolation, and the complete suite passed on retry without timeout overrides. Source hashes remained unchanged through final checks. Existing build CSS/import/chunk warnings remain.

CC0F evidence is under `C:/Users/nooro/AppData/Local/Temp/monocode-cc/cc0f/`: `REPORT.md`, `evidence/validation-summary.json`, `evidence/final-vitest-retry.json`, `evidence/frontend-focused-before.log`, `evidence/frontend-focused-after.log`, `evidence/native-regressions-red.log`, `evidence/native-regressions-fixed.log`, and `evidence/native-product-exact.receipt.json`. No real profile was repaired, no live provider turn was submitted, and no native GUI acceptance was attempted. Linux/macOS were not run; Unix claims still cannot exclude already-open writable handles, as the source's `shortcut:` comment records.
