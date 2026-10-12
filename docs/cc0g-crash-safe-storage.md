# CC0G crash-safe Codex storage

Branch: `HenkDz/cc0g-crash-safety`, based on `5801602ed7fed03f50db645dc5b61a89521cb91c`. Integration and publication remain coordinator-owned.

The CC0FR ship-gate review found that killing a process after claiming a private entry could silently activate account instructions on restart, and killing a corrupt-snapshot move could remove the guard that requires an explicit choice. CC0G persists transaction identity before moving entries and reconciles unfinished work before preparing storage.

## Changes

- Create-new, fsynced journals record intent, original name, claim identity/fingerprint, staged replacement identity/fingerprint, verification and independent archive. Keep journals survive until their private-override snapshots are saved.
- Restart restores a missing original with no-replace semantics and disables stale automatic recovery for interrupted shared-file choices. Verified published entries finish only with matching identities and independent preserved bytes. Windows publication, claim disposal and staged cleanup use the entries' own locked handles.
- Concurrent originals, changed stages, malformed/linked/path-escaping journals and unlabelled legacy claims remain preserved. A distinct recovery notice lists paths and offers refresh/folder reveal without unsafe version choices. Folder reveal derives its path from the held account rather than displayed recovery paths.
- Corrupt-snapshot transactions publish the invalid marker before moving the corrupt claim aside. Missing snapshots with older preserved corrupt siblings also require an explicit Keep/Use account choice.
- Remove the obsolete recovery-publication helper and keep its tests on the production staged-publication and claim-restoration paths. No dependency or policy option was added.

## Regression evidence

The actual native test executable is its own child harness. Parents wait for a complete checkpoint signal, terminate the child with the OS API, and start another process to prepare storage. **28 kill/restart cases** cover Keep (4), Use account (5), hardlink hooks isolation (5), symlink hooks isolation (5), ordinary relinking (4), and corrupt snapshots (5). Keep has no archive step. Checks retain private bytes or independent archives, keep account files unchanged, preserve corrupt authorization until an explicit choice, and leave no claims/stages/journals after successful reconciliation.

Ten additional native tests cover legacy claims in both storage locations, concurrent original recreation, changed stages, the actual hooks-stage replacement race, older corrupt siblings, invalid paths, hardlinked journals, forged relink intent, wrong-location corrupt intent, and changed/escaping archives. Frontend tests exercise parsing, rendered recovery actions and transitions, and the actual App reveal callback with the held account.

The two original CC0FR cases, `keep-after-claim` and `corrupt-after-move`, are committed regressions against production helpers rather than extracted-source probes. All fixtures are synthetic temp homes; no real profile was repaired.

## Validation

Windows/NTFS with Node 26.5.0 and `NODE_OPTIONS=--no-experimental-webstorage`. The full frontend suite passes **6,011 tests**, with **13 existing Antigravity real-provider/soak skips** and **0 failures**, across **547 passed and 2 skipped physical test files**. The focused native group passes **75 tests**, with **0 failures**, **1 intentionally ignored subprocess entry point**, and **613 filtered tests**. TypeScript, production build, touched-file Rust formatting and diff checks pass. Exact invocation timings and source hashes are in the round report and evidence receipts.

Evidence root: `C:/Users/nooro/AppData/Local/Temp/monocode-cc/cc0g/evidence/`.

- `native-final-builder.log`, `final-state.json`: final native suite and committed source hashes; `safety-native-final.log`, `safety-source-sha256.json`, and `safety-review.md` retain independent review evidence before the final test-only publication adapter cleanup.
- `crash-tests-native.log`, `crash-tests-native.ps1`: focused process-kill runner; fixture paths, child stdout/stderr and restart receipts are retained in synthetic temp directories printed in the log.
- `frontend-validation/FINAL-COMPLETE-VALIDATION.md`, final-complete logs/receipts and the unchanged-source production-build receipt.
- `../REPORT.md`: branch/commit, complete validation results and limitations.

## Limits

Process termination is tested; operating-system power loss is not. The storage mutex remains process-local. Linux/macOS and live desktop/profile/provider acceptance were not run. Unix already-open writers and concurrent path replacement cannot be excluded as on Windows; source comments retain that limit. Ambiguous legacy claims and concurrently recreated originals require inspection through the preserved-files notice. No automatic pruning, extra recovery-choice UI, merge, push or deployment was added.

## CC0H correction awaiting validation

The validation counts above describe CC0G's historical source. CC0GR3 later observed pathname-only journal cleanup, oversized-prefix parsing and an empty-journal allocation window, plus an unlabelled verification stage. CC0H's source correction binds retirement to identity and exact contents, publishes complete initial and verified authority through named pending stages, and adds explicit archival recovery for unpublished/legacy empty metadata. Default conversation diagnostics also follow the binding no-accordion requirement.

See [CC0H journal finalization](cc0h-journal-finalization.md) for ordering, legacy compatibility, the preserved original 11/39 observations and every pending gate. CC0H is explicitly source-only: no corrected-head native/web/browser acceptance or SHIP result is established. Source `secrets` first-creation and raw Windows long-path concerns remain separate follow-ups.
