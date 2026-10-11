# CC5DG: preserve live transcript anchors during digest verification

Manager digest verification no longer replaces a long live chat's saved block
cache with a ten-turn read-back page. A later managed turn and subsequent user
turn append from the correct live anchor and preserve archived history. Long
Windows project paths also no longer exhaust the digest header budget.

Branch: `HenkDz/cc5dg-wake-readback`. Starting commit:
`1147d9b7f051a0cb1712c7744b8e154541264da5`. The final commit and source-byte
verification are recorded in the external round report and commit receipt.

## Changes and decisions

`readPersistedSession` shares the existing native lookup and record hydration,
without changing `monoSavedBlocks` or invoking provider repair. Normal
`getSession` calls retain their cache initialization and repair behavior. The
App's Manager queue adapter uses the new reader for both queue verification
and consumed-receipt verification. Receipt body, request identity and managed
marker checks remain required before acknowledgment.

The actual frontend store regression uses native-shaped ten-turn reads and
transactional suffix writes. It covers 10, 11 and 25 user turns, repeated queue
acceptance, a persisted internal digest, consumed-receipt replay and a later
user turn. Provider cases prove that verification performs one lookup with no
repair calls or writes. The persistence matrix also rejects changed bodies and
request IDs. The native regression saves queue metadata, reads the recent page,
then appends after `a24`; all 52 blocks match the complete expected archive.
Native production code and uniqueness constraints are unchanged.

The header uses a project label of at most 100 characters and the stable Manager
ID. Full source events are reachable with the existing authenticated
`control list {} -> run.wakeState.events` route. Current Manager roster validation
requires exactly one project; the App maps that project to the run. Event IDs,
request IDs, evidence envelopes, action ordering and acknowledgment remain intact.
No executable project path is shortened.

The coordinator add-on replaces four wall-clock `vi.waitFor` calls in the
storage-preparation/rejection test with fake-clock advancement and direct
assertions. It advances the one-second retry deadline while storage remains
blocked, then accepts after repair. Every original assertion remains, and
preparation explicitly prevents acceptance. Production retry policy is unchanged.

Current `nour` was inspected at
`4966b0f0b357c8dc27be1b2fac1eeee7562575e4`, including CC5E-F's rotation document
and changed context/continuity code. Its orchestration implementation, target
test, wake scheduler and session store match this branch's starting versions.
Rotation code was left with the coordinator; no integration was performed.

Rejected alternatives: removing durable verification, repairing storage during
verification, changing native uniqueness rules, truncating executable paths,
increasing polling timeouts, or weakening assertions. The fixes reuse existing
storage, CLI and test-clock facilities without adding dependencies.

## Validation

Windows, Node `v26.5.0`, npm `11.17.0`, Vitest `3.2.7`, TypeScript `5.8.3`.
All Node validation uses `NODE_OPTIONS=--no-experimental-webstorage`.

| Check | Result |
| --- | --- |
| Full `npx vitest run --maxWorkers=4` | 6,601 passed, 13 skipped, zero failed; 6,614 tests. 574 passed files, two skipped, zero failed; 576 files. |
| `npx tsc --noEmit` | Exit zero, no diagnostics; 30.131 seconds. |
| `npm run build` | TypeScript and Vite pass; exit zero, 83.409 seconds. |
| Focused wake/store suites plus coordinator test | 135 passed, zero failed/skipped; included in the full suite. |
| `cargo test --jobs=4 --manifest-path src-tauri/Cargo.toml --lib mono_transcript::tests -- --nocapture` | Eight passed, zero failed/ignored/measured, 686 filtered; 179.859 seconds. |
| Formatting and whitespace | Touched native file's `rustfmt --check` and `git diff --check` pass. |
| Reviewer paged read-back and long-path engine cases | Two passed each; zero failed. Four unrelated external engine cases deliberately filtered. |

Full-suite wall time is 155.063 seconds (153.20 seconds in Vitest). The first
eight-worker run failed only the coordinator's wall-clock test; its original
assertions remain in the fake-clock version that passes the final full run.

## Evidence

Root: `C:/Users/nooro/AppData/Local/Temp/monocode-cc/cc5dg/evidence/`.

- `original-findings/paged-readback-*`: the retained reviewer fixture still
  fails at eleven turns with the original normal-load callback (one passed,
  one failed). Changing only the verification callback produces two passes.
- `native-anchor/`: eight focused native tests pass, including rollback and
  the new full-archive anchor check; source hash, command and log are retained.
- `long-path/`: both forms of an existing 3,732-character Windows directory
  produce 749-character formatter digests. The actual Orchestrator accepts one
  740-character digest per form, acknowledges once and has no retry blocker.
  Native canonicalization and directory checks also pass.
- `validation/`: the initial eight-worker run records the coordinator's test
  timeout (6,600 passed, one failed, 13 skipped). `final4/` holds fresh required
  checks after the deterministic fix, including full JSON and source manifests.
- `commit-proof/`: binds committed source bytes to validation and checks patch
  applicability against current `nour` using a separate temporary Git index.

## Limits

No real profile writes, live preview, model turns, packaging, push, branch merge
or deployment occurred. Native checks use synthetic in-memory storage; engine
checks use synthetic provider/storage hosts. The coordinator owns integration
and live acceptance. Existing dependency advisories and build warnings were not
remediated. Broader native/browser checks remain outside this round.
