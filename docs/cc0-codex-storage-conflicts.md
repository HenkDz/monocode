# Codex storage conflicts (CC0 and CC0F)

Original CC0 branch: `HenkDz/r27-storage-repair`, based on `de8edc3b389c3362134cc5a521458b241496b4c2`. CC0F extends it on `HenkDz/cc0f-storage-fixes`. Integration into `nour` and publication remain coordinator-owned.

Atomic replacement of an account file detaches its Windows hardlink in Mono storage. The old copy becomes a lone real file, so preparation reports a conflict and Repair repeats the same failure. This affects hooks, instructions, and configuration rewritten through temp-file rename.

## Patch

- Prefer file symlinks for shared entries, with hardlink fallback. Record shared-content SHA-256 snapshots in `.monocode-links/`. A detached shared file heals only when it matches the account version, its recorded snapshot, or the exact empty hooks object in opted-in sharing mode. Archive its bytes under `.monocode-conflicts/<timestamp>-<uuid>/` before relinking. Preserve existing untracked private config overrides. Hooks are private by default, as described below.
- Return structured conflict metadata inside the existing storage-error envelope. Native resolution offers the account version or a durable private Mono version, plus bounded comparison and folder reveal. Derive paths from the selected account, reject stale fingerprints and Windows path/state aliases, and keep credentials shared. Config and login contents are excluded from comparison.
- Preserve bytes on failed publication and concurrent file recreation. Require real metadata/backup directories. A deleted private override returns to account sharing on preparation for shared entries; isolated hooks return to their empty private default.
- Group Inbox issues by account and show one compact card per blocked conversation. Offer version choices, Compare, Show in folder, and collapsed copyable details. Member status says `Blocked · storage`; held messages say `Waiting for storage repair`.
- Coalesce account repair, wait for in-flight preparations, retain the original account, and resume held submissions after resolution. Durable queues respect edits and cancellation; failed restarts retain their retry action. Show brief success feedback.

## Reproduction

Use synthetic temporary homes. Create a real hardlink, record its shared snapshot, then replace the account file through temp-file rename. Confirm that the Mono file retains the old bytes with one remaining link. Prepare again and verify the byte-identical archive and current account link. Repeat for `AGENTS.md`, `config.toml`, and opted-in `hooks.json`; also verify divergent-file choices, private overrides, stale requests, busy files, concurrent recreation, and credential/state aliases. A file-symlink fixture follows source replacement immediately. In default isolated mode, verify an independent empty hooks file, byte-preserving migration of old links, retention of private custom hooks, and independence from account rewrites.

## CC0F review fixes

CC0F builds on CC0 through a local merge in `HenkDz/cc0f-storage-fixes`. The independent CC0R review reproduced five defects despite the original validation passing.

- Classify the actual Windows directory entry before resolve, compare, or reveal. Real NTFS short names cannot bypass credential or private SQLite rules.
- Claim an entry before replacing it or judging its recovery eligibility. On Windows, operate on the entry's own handle and deny concurrent writes/replacements while verifying it. Publish with no-overwrite semantics; preserve and report an entry created by another writer.
- Recheck the claimed bytes for automatic recovery and both explicit choices. Rejected objects are restored safely; committed conflict archives hold independent real bytes, never symlinks.
- Clear each live account member's storage error immediately before its held submission replays. A conversation joining during relinking or an earlier replay participates in the same repair and cleanup.
- Preserve corrupt snapshot metadata and require a fresh explicit conflict choice, including on subsequent retries. Keep a returned conflict available while Compare or Show in folder clears transient action errors.

The committed regressions use synchronized external writers, actual NTFS aliases, the real App callback and submission preflight, and rendered notice actions. All fixtures use synthetic temporary homes. Shared-hooks regressions opt in explicitly, preserving their original safety coverage under the new default.

## Crash safety

CC0G adds create-new, fsynced `.monocode-txn-<uuid>.json` journals before an entry moves to `.monocode-claim-<uuid>`. The record identifies the original entry, Keep/Use account/hooks-isolation/relink intent, entry identity and fingerprints, staged replacement, and any verified independent archive. Keep retains its journal until its private-override snapshot is committed. Completed transactions remove their journal only after restoring, independently preserving, or disposing of the claim.

Preparation and explicit resolution reconcile journals first under the existing storage lock. A missing original is restored without replacement, and interrupted shared-file choices disable automatic healing until a fresh choice. A verified published replacement can finish when its identity and preserved archive still match. Concurrently recreated originals, changed staged files, unreadable journals, and legacy claims without journals remain preserved and block preparation. Their structured recovery notice lists paths and offers Refresh issue and Show in folder; it does not guess a filename or offer a version choice for ambiguous recovery files.

Corrupt-snapshot transactions publish a durable invalid marker before moving the corrupt claim to its preserved sibling. Restart completes or rolls back that transaction without losing the explicit-choice guard. A missing snapshot with a preserved `*.corrupt-*` sibling from the older implementation also recreates an invalid marker; an explicit Keep or Use account decision writes resolved metadata while retaining the corrupt bytes.

Committed native tests terminate a child through the OS process API and prepare again in a fresh process. The 28 cases cover journal creation, claiming, verified archiving, before/after publication, Keep restoration, ordinary relinking, hardlink and symlink hook migration, and the corrupt-snapshot move. They verify recoverable private bytes, independent archives, unchanged account files, explicit corrupt-metadata choices, and no leftover claims, stages or journals after successful recovery. Additional tests reject ambiguous, changed and forged recovery records and preserve a concurrently replaced stage.

Evidence and final validation are recorded in `docs/cc0g-crash-safe-storage.md` and `C:/Users/nooro/AppData/Local/Temp/monocode-cc/cc0g/REPORT.md`. These checks cover Windows process termination, not operating-system power loss. The storage lock remains process-local; Unix concurrent writer/path exclusion remains limited, as documented in the source. Ambiguous legacy recovery files need inspection rather than automatic deletion.

## Hooks policy addendum

The owner chose isolated Mono hooks. Missing `hooks.json` gets a create-new private `{"hooks":{}}` file. Existing real private hooks stay intact and cannot conflict with account hooks. Existing file symlinks or hardlinks are claimed, their referenced bytes archived into an independent real file, and their active entry replaced with the empty private default. Account hooks are never modified by this migration. The account's hooks snapshot is ignored in isolated mode, so a stale or corrupt sharing snapshot cannot block preparation. Busy or unreadable links are preserved and produce an actionable IO error.

The account-scoped preference is stored in the private Mono home's `.monocode-hooks-policy.json` as `{"shareHooks":true}` or `false`. Missing or malformed real metadata stays isolated; malformed bytes are retained and logged. Linked policy paths are rejected. The native setter saves policy/authorization metadata without preparing or changing active hooks files; preparation applies it on the next Mono turn. When switching from isolated to shared, it retires a valid old private override so distinct custom hooks reach the normal explicit version choice. An idempotent shared save keeps an existing explicit override, and corrupt snapshots retain their safe recovery rules. Stale resolution requests cannot relink hooks while the account is isolated, including through an 8.3 alias.

Mono settings reuse the existing switch beside Selected Codex home. It says **Share hooks from ~/.codex** for the default source, or **Share account hooks** for a provider account or `CODEX_HOME`. The description explains that it affects all Monos using that account on their next turn. Saving, failures, refreshes, and account switches retain the correct account scope. Explicit sharing uses the existing safe conflict/choice flow for custom files; the opt-in UI was small enough to include in this round.

## Original CC0 validation

**38 focused Windows native tests passed**, with zero failures or ignored tests. The full frontend suite passed **5,993 tests**, with 13 existing Antigravity real-provider/soak tests skipped and zero failures. `tsc --noEmit`, `npm run build`, `cargo fmt --all -- --check`, and `git diff --check` passed. Frontend commands used `NODE_OPTIONS=--no-experimental-webstorage`; existing CSS/chunk warnings remain.

Evidence is retained under `C:/Users/nooro/AppData/Local/Temp/r27-storage-repair/`: `REPORT.md`, `native-tests.log`, `vitest.json`, and frontend validation logs/receipts. No real-profile repair, native GUI acceptance, preview, or model turn was attempted. Hardlink fallback reconciles on preparation; real directory conflicts remain preserved and fail closed. Backups have no automatic pruning.

## Initial CC0F validation before the hooks addendum

The final frontend suite passed **5,999 tests**, skipped **13 existing Antigravity real-provider/soak tests**, and failed **0** across **547 passed and 2 skipped files**. TypeScript and the production build passed. The focused frontend run passed **28 tests**. The focused Windows product suite passed **46 native storage tests**, with **0 failures or ignored tests** and **608 filtered tests**. Only the touched Rust file was formatted and checked.

Before the fixes, the six ported native reproductions all failed, and the App/UI regressions had four failures. These logs are retained. An initial final full frontend run hit two unchanged file-editor test timeouts under overlapping validation load; those four file-editor tests passed in isolation, and the complete suite passed on retry without timeout overrides. Source hashes remained unchanged through final checks. Existing build CSS/import/chunk warnings remain.

CC0F evidence is under `C:/Users/nooro/AppData/Local/Temp/monocode-cc/cc0f/`: `REPORT.md`, `evidence/validation-summary.json`, `evidence/final-vitest-retry.json`, `evidence/frontend-focused-before.log`, `evidence/frontend-focused-after.log`, `evidence/native-regressions-red.log`, `evidence/native-regressions-fixed.log`, and `evidence/native-product-exact.receipt.json`. No real profile was repaired, no live provider turn was submitted, and no native GUI acceptance was attempted. Linux/macOS were not run; Unix claims still cannot exclude already-open writable handles, as the source's `shortcut:` comment records.

## Final CC0F validation including hooks isolation

The full frontend suite passed **6,006 tests**, skipped **13 existing real-provider/soak tests**, and failed **0**, across **547 passed and 2 skipped files**. TypeScript and production build passed. The focused frontend run passed **45 tests**. The actual Windows product suite passed **59 native storage tests**, with **0 failures or ignored tests** and **608 filtered tests**; storage-file format and diff checks passed. This includes the previous 46 native tests plus 13 policy tests. The shared-hooks regressions explicitly opt in rather than losing their original coverage.

Five core isolation tests failed against the pre-policy implementation; all 13 policy tests then passed in the helper harness, and all 59 passed in the actual product. Tests cover private defaults/custom hooks, old symlink and hardlink migration, concurrent custom replacement, independent archives, repeated account atomic rewrites, stored account opt-in and re-opt-in, stale aliases, malformed policy, protected metadata, and busy/dangling references. Native and frontend source hashes stayed unchanged through validation.

Final evidence: `evidence/addendum-validation-summary.json`, `evidence/addendum-vitest.json`, `evidence/addendum-tsc-receipt.json`, `evidence/addendum-build-receipt.json`, `evidence/frontend-focused-hooks-after.log`, `evidence/addendum-native-product.receipt.json`, `evidence/addendum-harness-red.log`, `evidence/addendum-harness-fixed-full.log`, and `evidence/addendum-final-state.json`. Earlier evidence remains labeled for the pre-policy commit. Validation used synthetic files and rendered tests; no installed-app acceptance, real-profile migration, or hook execution was attempted.
