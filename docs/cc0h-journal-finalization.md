# CC0H journal finalization

Tested implementation: `0c37b44a65cead9e66610a6dfc80c90910178e75`, including exact incoming `ecf907a28335c1defd8386f22e85e6600acc913b` merged into this branch. Builder validation is complete; root integration, a fresh joint storage/permission review and release gates remain required. No SHIP claim is made.

## Authority and interruption order

CC0GR3's `40a4b82` observations showed pathname-only journal deletion, acceptance of an oversized JSON prefix, and an empty authoritative journal after process termination during allocation. An interrupted verification also left an unlabelled stage. The original raw 11/39 observation fixtures remain rejection evidence.

1. Serialize the complete transaction before allocating metadata. Hold the exact recorded Windows data stage with a delete-pending guard until complete authority owns it. Refuse an altered or shared stage without adopting or changing it.
2. Exclusively allocate `.monocode-txn-<UUID>.json.pending`, write and sync the complete record, then publish through its own held handle without replacing a target. Only the complete initial `.json` authorizes moving the original into its claim.
3. Keep initial authority immutable. Publish `.monocode-txn-<UUID>.verified.json` through another exclusive pending stage. Its authority records the initial journal name, file identity and exact fingerprint. Both files describe one logical transaction.
4. Reconciliation validates surviving linked authority before using it. A complete verification can finish after interruption between initial and verified retirement. Unpublished metadata stays explicitly blocked.
5. Before stage cleanup, pin the original and verified metadata as real single-link files and check held identity/content. Retire only the exact owned files through their Windows handles. Replacements, changed contents, missing required verification and unfamiliar files remain preserved. An in-memory completion flag prevents a second Drop cleanup from reinterpreting completed ownership.

Reads accept at most **65,536 bytes**, detect an extra byte, and parse the entire accepted buffer. Exact-limit valid JSON plus whitespace passes. Oversized whitespace, invalid tails, truncated input, unknown fields/intents, hardlinks and reparses are refused.

## Windows stage and attribute boundaries

The first full run exposed error 50 when arming an ordinary file with clone-oriented DELETE_ON_CLOSE disposition. An actual Rust handle witness showed ordinary no-replacement renames succeed; occupied targets reject with error 183 while retaining exact target bytes/identity. The defect was disposition arming.

Ordinary stages use DELETE flags **1**, or DELETE plus IGNORE_READONLY **17**, and clear with **0** before publication. The original clone handle, created DELETE_ON_CLOSE, retains its separate clear-ON_CLOSE **8** operation. These operations are not interchangeable: clearing an ordinary pending deletion with 8 still deletes at close. Rust probes cover writable/READONLY stages, occupied targets and three real child kills while preserving source attributes and bytes.

The protected `sandbox_config.rs` integration now denies foreign writes/deletes while creating the private stage, closes that writer before the claim lease, and uses `RecordedEntry::pin_attributes` for subsequent attribute restoration. That held handle rejects non-files, multiple links and reparse attributes, then checks held identity and exact contents before any attribute write. The actual same-inode alias-before-claim control retains alias identity/bytes/attributes **32**, source bytes/READONLY attributes **33**, and the original private config. All J runtime families, including six kill boundaries and legacy recovery, were rerun.

## Explicit incomplete-metadata recovery

Unpublished metadata and legacy empty initial journals expose **Archive incomplete metadata** with a string identity and SHA-256 receipt. The native command validates existing canonical account/private roots without provisioning them, strict parent/reparse rules, the exact single-link leaf and held identity/content. It refuses stale receipts and nonempty authoritative initial journals.

The producer's Windows `path_to_js` slash representation is converted to native separators for lexical comparison against trusted home; the leaf is never canonicalized to conceal a reparse. The exact file is renamed without replacement into a real `.monocode-preserved-transactions` directory, retaining bytes, identity, timestamps and attributes. Preparation can then reconcile remaining authority; unfamiliar stages or unlabelled legacy claims may still require inspection. Archival does not reset data or grant permissions.

## Presentation and disclosed fixture adaptations

Default storage diagnostics are flat, visible and focusable, with the existing Copy button. The old closed-Details positive expectation was replaced by the binding no-accordion expectation and exact diagnostic text; existing recovery/byte/safety/command assertions remain. Attention retains its custom Evidence renderer, and sandbox commands remain verbatim.

The protected `sandbox_config_tests.rs` snapshot-failure fixture was explicitly authorized to change from one raw journal to **exactly two linked authority records for one transaction**. It asserts a valid UUID, matching initial/verified filenames, the same claim UUID, entry/intent/claim/stage equality, initial false/verified true status, and the verified record's exact initial name/identity/fingerprint. Every original source/backup/attribute/reconciliation/final-clean assertion remains. The original **159 passed / 4 failed** run remains preserved. The module also adds the same-inode alias control; this replaces no different-inode assertion.

Six other protected modules remain unchanged: archive, skills, Codex store composition/private-config tests, AttentionQueue and AttentionDetails. All 38 incoming non-App files remain exact; App contains incoming source plus the six H archival lines. Integrity checks retain 24 original transaction/crash helpers and eight J helpers unchanged.

## Actual validation

All required builder gates used isolated synthetic homes, one Cargo job/native thread and one Vitest worker. Node retained `NODE_OPTIONS=--no-experimental-webstorage`. All **1,692** implementation/test/config inputs remained unchanged.

| Gate | Result |
| --- | --- |
| Locked local dependencies | 428 packages installed from lock, no lock changes |
| Actual full crate storage group | **164 passed / 0 failed / 4 original ignores / 628 filtered** |
| Actual harness / Mono groups | **26/0/0** and **14/0/0** |
| Original Windows journal controls | **11 passed**: two live replacements, nine kill/parser controls |
| Process matrix | **39 original + 3 new cases passed**; actual children stopped/restarted, final successful recovery has no owned orphans |
| Actual old `40a4b82` crate | Four journal correct-behavior controls fail as expected; fresh original read-only failure also retained |
| Corrected fresh old read-only fixture | **1 passed**, exact source bytes/attributes preserved |
| Original literal external J control | **4 passed / 1 raw-prefix assertion failed / 1 ignored** |
| Separate canonical external J control | **5 passed / 0 failed / 1 ignored** |
| Focused frontend | **262/0**, 14 files |
| Full one-worker Vitest | **8,283 passed / 0 failed / 13 original skips**, 625 passed / 2 skipped files |
| TypeScript / production build | Both pass; build retains large-chunk advisory |
| Chromium production recovery/Attention | **162 checks / 44 inspected PNGs**, dark/light at 1440/390; **18 additional scroll checks / 4 inspected PNGs** |

Evidence: `C:/Users/nooro/AppData/Local/Temp/monocode-cc/cc0h/evidence/`. `final-integrity-current.json` binds source; `native-controls/source-manifest.json` describes complete actual old/current crates with test-only modules and pause-only instrumentation, no stubs. Original literal tests and the single canonical assertion adaptation remain separate. `journal-windows-results.json` and `process-matrix-39-current.json` bind real processes and receipts. Browser folders retain actual PNGs, driver snapshots, isolated fixture source, source hashes and cleanup receipts.

Every failed attempt remains recorded. Native progression was **88/75/4**, **159/4/4**, **163/0/4**, then **164/0/4** after the alias guard. Source corrections were refrozen and affected gates rerun. The first supplementary browser scroll attempt lacked the app's bounded parent container; correcting only the fixture allowed the unchanged scroll assertions and repeated full browser matrix to pass. All browsers/servers and native child jobs are finished.

## Limits and release boundary

Source `secrets` first-creation and conditional raw Windows long-path behavior remain separate observed follow-ups. Parser preservation fixtures preseed secrets; their success does not erase missing-directory behavior. The literal raw-prefix failure remains a failure and is never relabelled as a canonical pass.

Process termination is proven; OS power-loss durability is not. Unix runtime/writer exclusion, arbitrary parent-directory replacement, native WebView/desktop lifecycle and real OS clipboard acceptance remain unproven. Browser clipboard writes were instrumented; product components and pointer/keyboard actions were real. No real profiles, model turns, account/ACL setup, unrelated preview, fan-out, push or deployment occurred. Root integration and a fresh corrected-head joint storage/permission review still own release acceptance.
