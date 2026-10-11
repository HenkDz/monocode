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

## Validation

**38 focused Windows native tests passed**, with zero failures or ignored tests. The full frontend suite passed **5,993 tests**, with 13 existing Antigravity real-provider/soak tests skipped and zero failures. `tsc --noEmit`, `npm run build`, `cargo fmt --all -- --check`, and `git diff --check` passed. Frontend commands used `NODE_OPTIONS=--no-experimental-webstorage`; existing CSS/chunk warnings remain.

Evidence is retained under `C:/Users/nooro/AppData/Local/Temp/r27-storage-repair/`: `REPORT.md`, `native-tests.log`, `vitest.json`, and frontend validation logs/receipts. No real-profile repair, native GUI acceptance, preview, or model turn was attempted. Hardlink fallback reconciles on preparation; real directory conflicts remain preserved and fail closed. Backups have no automatic pruning.
