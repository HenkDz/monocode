# CC0H journal finalization

Base: `2bd9b5231b1891fa894dfc3cfc21e36cc097d94b` (integrated CC6J). This is a **source-only correction pending required validation**. The coordinator explicitly kept CC0H source-only; no compilation, full suite, build, browser, screenshot or preview has been run. The exact committed source and hashes are recorded in the external CC0H report and VALIDATIONREADY.

## Problem and ownership

CC0GR3's frozen `40a4b82` observations showed pathname-only journal deletion, acceptance of an oversized valid JSON prefix, and an empty authoritative journal after process termination during allocation. Its verification write also left an unlabelled stage. The raw 11 journal witnesses and 39 interruption cases remain rejection evidence; their observation assertions are not correct-behavior passes.

CC0H changes transactions and their native/UI recovery boundary. CC6J's held-handle read-only unlink, verified backup attributes, private override composition, snapshot repair and legacy stranded repair remain. Rotation, provider configuration, working-folder binding, Workbench and Attention's existing evidence presentation are outside this change.

## Publication and interruption order

1. Serialize the entire initial transaction before allocating metadata. Hold any recorded Windows replacement stage with deletion at handle close until the published journal owns it. A changed stage is recorded as blocked recovery rather than adopted or deleted.
2. Allocate `.monocode-txn-<id>.json.pending` exclusively, write all bytes, sync the file, and publish through its own held handle with no replacement. Only the complete `.json` file authorizes moving an original to its claim.
3. Keep that initial journal immutable. Verification publishes `.monocode-txn-<id>.verified.json` through its own exclusive `.pending` stage. It records the initial journal's file identity and exact content fingerprint. An interrupted write therefore leaves either the original authority or a complete verification; an unpublished stage remains explicitly recoverable.
4. Reconciliation accepts existing legacy journals and complete verification records. It checks surviving initial authority against verification before using it. A complete verification can finish recovery after a stop between initial-journal retirement and verification retirement.
5. Before cleaning a recorded data stage, retirement pins and checks the journal identities, single-link real-file status and exact fingerprints. It retires the initial journal and then verification through their own Windows handles. A replacement, changed content, missing required verification or unfamiliar pending file stays blocked and preserved. An in-memory completion flag makes the existing second Drop cleanup harmless.

All authority reads are bounded to **65,536 bytes**, with an extra-byte check and parsing of the entire buffer. Exactly 65,536 bytes of complete JSON plus allowed whitespace remains valid. Over-limit whitespace, invalid trailing bytes, truncated input, unknown fields/intents, hardlinks and reparses are refused. Unknown authority is never automatically deleted.

## Explicit incomplete-metadata recovery

Unpublished metadata and legacy empty initial journals remain blocked across repeated preparations. Their notice offers **Archive incomplete metadata** using a native receipt with a string-encoded identity and SHA-256 fingerprint. The native command derives the held account's private home, rejects escapes and linked parent directories, pins the exact single-link file, and refuses a stale receipt or a nonempty authoritative journal.

The selected file is renamed without replacement into a real `.monocode-preserved-transactions` directory beside it. Its bytes, identity, timestamps and attributes are retained. A conversation receipt records the archive path. Preparation then reconciles the remaining authority and claims; it can still require an ordinary version choice or inspection of an unlabelled legacy claim. Archival does not reset user data, grant a private override, or erase an unfamiliar data stage.

Windows initial stage lifetime handling reuses the existing clone-disposition mechanism. Unix has no comparable writer/path exclusion here; concurrent Unix retirement and pre-journal stage cleanup remain unproven.

## Conversation presentation and policy adaptation

The default storage notice now presents diagnostics directly, with a keyboard-focusable scrolling text region and the existing Copy details button. Ordinary conflict choices, comparisons, busy guards, preserved paths, folder reveal and refresh remain. Attention's supplied Evidence presentation and the sandbox's exact manual command remain.

The old positive expectation that default Details was closed was intentionally replaced by absence of an accordion and exact visible diagnostic text. The clipboard-failure selector was updated to the same flat region. All existing byte, recovery, safety, command and interaction assertions remain; no deadline or skip changed. This is the binding no-accordion requirement from the brief, not a new product decision.

## Prepared regressions and evidence

- Ten new native tests cover identity/content replacement, a replacement claim retaining its label, parser boundaries, unknown bytes/fields, reparses, stale/outside/linked recovery receipts, exact archival, read-only attributes, verification replacement and real process termination.
- The production test executable remains the child harness. Its existing 32 matrix cases plus seven former journal/verification/retirement boundaries map to all original **39** cases. Two publication boundaries and a separate initial-allocation control add three cases. Existing CC0/CC0F/CC0G and CC6 interruption families remain required.
- Four new frontend tests cover metadata parsing, flat recovery/action presentation, held-account archival/replay, and failure retaining pending submissions.
- Four counterexample tests are prepared for the old `40a4b82` full native crate. The initial-allocation counterexample needs one pause-only hook in old source. They have not been compiled or executed; no baseline-failure or corrected-pass claim is made.
- A production-component browser fixture is prepared for 1440/390 layouts, pointer/keyboard Copy, metadata action, Attention Evidence and verbatim sandbox command. It has passed JavaScript syntax checking only. No screenshots exist yet.

Evidence root: `C:/Users/nooro/AppData/Local/Temp/monocode-cc/cc0h/evidence/`. `baseline/` preserves seven raw CC0GR3 files; `baseline-inventory.json` records their hashes. `witness-manifest.json` maps the original 11/39 cases to actual tests with source hashes. `run.py` retains every validation attempt under a unique label and binds pre/post source hashes. The first witness-preparation attempt failed on an incorrect historical helper name; its failure is retained, and corrected preparation passes without changing any product assertion.

A later formatting check also failed after the archive-directory guard was added. The touched file was formatted and the five-file check then passed. Both receipts remain; no product test run is hidden by these preparation corrections.

## Validation and follow-ups

Completed small checks: touched-file Rust formatting/syntax on five files, browser-fixture JavaScript syntax, baseline inventory, 11/39 witness mapping and Git whitespace/source integrity. These are preparation checks; **zero product tests and zero screenshot inspections have run on CC0H**. Exact receipts and timings are in REPORT.

Pending: locked dependencies; correct-behavior and old-pin native counterexamples; actual full native crate storage/mono/harness groups and Windows filesystem families; full one-worker Vitest with `NODE_OPTIONS=--no-experimental-webstorage`; TypeScript; production build; real wide/narrow screenshot inspection. The native child ignores and existing frontend skips remain unchanged. A fresh independent corrected-head storage review still owns release acceptance.

Separate follow-ups retained from CC0GR3: first preparation creates a missing source `secrets` directory; raw Windows paths can fail beyond MAX_PATH while extended-prefix fixtures succeed. CC6J also retained an external fixture's raw-path-prefix assertion failure separately from its canonical control. None is silently treated as fixed by this journal change. Real profiles/models, automatic account/ACL setup, OS power-loss durability, Unix runtime acceptance, arbitrary external parent-directory replacement and shipping are unproven or outside scope. No merge, push or deployment was performed.
