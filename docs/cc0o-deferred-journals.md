# CC0O deferred optional journals

On Claude-cleared CC0N `b9763f6`, an interrupted optional journal could be deferred
for a Windows sharing lock while the same prepare recreated or removed its entry.
An account-file rewrite then left replay permanently refusing another entry at
the original path, even after the handle closed. Synthetic native regressions
first reproduced both prepare-loop failures and repeated refusal after release.

`transactions::reconcile` now returns the names deferred by its existing validated
optional-entry and sharing-error checks. Both prepare loops skip those names for
that preparation. The next preparation reconciles the actual journals again;
pending diagnostic records never authorize skipping. Unrelated entries continue
normally. Journal replay, opaque metadata, identity-pinned destructive operations,
essential config/AGENTS/auth and resumed-rollout guards remain unchanged.

Native sharing errors name the Codex desktop app, Orca Codex terminals, other
Monos, or another Codex app-server/file reader as likely holders, while explicitly
retaining "exact holder unknown". Operation/path and parseable recovery fields
are preserved. No App or SessionPane edit is part of this change.

Accepted base: `dc2703fb4f73ac787f6b2312e786e21a5ffa69b7`, tree
`8e1c46ead0a5894c99cb4f4d3abfba4df61a3be1`. Its native source matches b976.
Code execution pin: `56e76423f63e123a4d60a941d6574bb020ba0362`, tree
`45327059df6fae83f7a5a990ba5cbd1f46847333`. This documentation commit changes
no execution input; the final manifest binds it to the tested source.

| Validation | Result |
|---|---|
| Cleared-base first reproduction | 0 passed / 2 failed / 0 ignored, retained |
| Cleared-base released-handle reproduction | 0 / 1 / 0, retained; repeated nonretryable refusal |
| Corrected Windows sharing group | 18 / 0 / 0 |
| Plain native storage group | 223 / 0 / 5 unchanged ignores |
| Plain harness group | 26 / 0 / 0 |
| Original A49 supplemental module | 10 / 0 / 1; 49 original rows plus 4 authority controls |
| Original H11 Windows controls | 11 pass, 9 kills / 2 resumed replacements, all children reaped |
| Original H39 process matrix in the plain run | 39 cases plus 2 publication cases and 1 allocation control |
| Original withdrawn stale-link race | Current production executable preserves replacement and old bytes; child reaped |

All heavy starts checked fresh RAM >=3 GiB; FULL B used one sequential stream,
one Cargo build job and one test thread. Plain gates use the unpatched native
executable. A49/H11 use a separately recorded test-source export with only the
original test registration and checkpoint adapter; original assertions, deadlines,
ignores and skips are unchanged. No Cargo features or executable manifests change.

Evidence: `C:/Users/nooro/AppData/Local/Temp/monocode-cc/cc0o/`, especially
`DIAGNOSIS.md`, `REPORT.md`, `CHECKPOINT.md`, `CLAUDE-REQUEST.md`,
`validation-summary.json`, `guard-equivalence.json`, `controls-provenance.json`,
`control-source-verified.json`, and `final-candidate-manifest.json`.

The old `20ace20` byte-loss race remains a withdrawn failure. Baseline formatting
differences in the main store and transaction files, and the inherited unused-mut
warning, remain disclosed. No full frontend build/suite, duplicate broad Mono
group, live provider/model, private profile, preview, install, push or deployment
ran. Actual installed-user acceptance and independent Claude clearance remain
separate from these synthetic results. Root remains the sole integrator.
