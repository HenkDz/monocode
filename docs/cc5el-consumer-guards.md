# CC5EL: guard orchestration guidance and outgoing recap issuance

At validated base `ecf907a28335c1defd8386f22e85e6600acc913b`, the retained
CC5EKR probes issued one synthetic OpenCode HTTP request in each of three
expected-safe refusals. App's orchestration host steer omitted the authority
callback; the outgoing handoff helper sent its own recap between App's checks.
The same three cases now refuse before transport, with zero prompt requests.

## Changes

App's host steer captures the complete saved rotation receipt and current
generation before appending guidance. Unreadable authority refuses immediately.
The existing synchronous `validateDispatch` checks generation and the receipt
at actual issuance through the unchanged registry and provider adapter. A
refused follow-up marks only its own guidance block as a draft, so a later
rotation cannot adopt unsent guidance. It preserves the original busy state,
streaming answer, running tool, provider binding and canonical running-tool
status. Genuine provider errors retain the existing visible guidance and
propagated error behavior.

App's pending-switch branch passes its receipt/generation callback through
`requestOutgoingHandoff` into the helper's registry send. The recap itself is
protected after all adapter preparation/configuration awaits. Existing Stop,
current-live and cancellation checks remain. Supervised mode, approval denial,
question skipping, the 45-second timeout, deterministic fallback and the
post-await generation/receipt gates retain their existing behavior. Recap
acceptance does not clear carry or claim ownership of the next dispatch.

No receipt format, scheduler, permissions, provider implementation, registry,
configuration, native source or unrelated App behavior changed.

## Connected consumers

| Caller | Authority contract |
| --- | --- |
| Ordinary/direct/queued/recovery sends | Existing shared App send closure captures receipt and generation; registry preserves callback through queueing and CLI wrapping |
| Queued and direct busy follow-ups | Existing App callbacks preserve their receipt/generation checks and follow-up error policies |
| Orchestration/host running-worker guidance | Newly guarded App callback; orchestration's command awaits it before recording success |
| Outgoing handoff recap | Newly forwarded callback from App through the helper and registry to issuance |
| Hermes background continuation | Existing callback runs on every prompt iteration after awaited handoff reads and Stop checks |
| Isolated side questions, titles and other text generation | `promptHarnessText` is absent at this head; `runHarnessTextPrompt` uses a separate text contract and cancellation owner, without loading or accepting the Mono carry |
| Remote/host transport and unsupported steering | Existing separate host/remote contracts and unsupported refusals retained |

All eleven send adapters and seven supported steers retain their existing
transport guards: Codex, Claude, Pi, OMP, OpenCode v1/v2, Cursor and Hermes;
Devin, fx, Grok and Antigravity also guard sends and retain unsupported steer
refusals. Cursor's awaited fallback and Hermes's background loop are covered
by the retained connected tests. There is no await between their final
callback and renderer-side request issuance.

## Final validation and integration

Validated source `5a1c0ed0b6362b5bde7f627c27e672641da4328a`, tree `65d2c083763e24c4b6ec7e0ad2d91ec243b8e9b2`.
Only validated nour `ec1250de4f0abc0af781485ed581aa0cc81bff7d` was merged
into this own branch, through `82b727b726f9190a2dac7d8f5a731b6cf64dd710`.
Both App deltas were preserved; 1,929 other incoming file blobs/modes match.
H authority/path/paired-authority/single-link/pinned-attribute/flat-notice and
all incoming routing/binding/rotation/migration/private-config/metrics guards
remain intact. The original caller fix is `03d179dbc4b19e45d48105da30927bf0e2b7216d`.

The initial TypeScript gate at 82b727b failed five Array.at uses: the project
targets ES2020. Commit 5a1c0ed replaces those five uses with slice(-1)[0] in
the host guidance seam and its new tests. Compiler configuration is unchanged.
Every assigned family/control and the full pipeline was rerun after refreeze.

Windows/Node v26.5.0, NODE_OPTIONS=--no-experimental-webstorage, one worker.
All jobs were sequential within the assigned slot. Assertions, deadlines,
retries and skips remain unchanged.

| Corrected-head gate | Passed | Failed | Skipped/todo |
| --- | ---: | ---: | ---: |
| Original actual caller refusals | 3 | 0 | 0 |
| New connected caller cases | 32 | 0 | 0 |
| Lifecycle / contract / binding / independent | 37 / 9 / 9 / 9 | 0 | 0 |
| Connected providers/App/registry, 19 files | 693 | 0 | 0 |
| Historical source, 24 files | 639 | 0 | 0 |
| Historical external, 13 files | 129 | 0 | 0 |
| Writer / entry / migration / shared preflight | 6 / 5 / 3 / 10 | 0 | 0 |
| E/F/G A/B/C runners | All three exit 0 | 0 | 0 |
| Complete Vitest | 8,315 | 0 | 13 existing skips / 0 todo |
| tsc --noEmit / production build | Both exit 0 | 0 | n/a |

Complete Vitest took 340.041 seconds, TypeScript
14.727 seconds and build 32.373 seconds.
All 1,716 source/test/config/package hashes match before/after every final gate.
The 13 skip names match the validated H baseline. All original 627/639/129
case names and 37 lifecycle names remain; all 101 original lifecycle expect
statements plus the approved 102nd zero-HTTP observation remain. Counts overlap.
The original three base cases issued one synthetic HTTP request each; corrected
source-extracted production callbacks/registry/OpenCode tests issue zero on refusal.

All earlier failures remain: three original safe failures; the source-stage
message mismatch and two synthetic v2 startup failures; the first full runner's
UTF-8 decoding failure after valid 8,315/0/13 output (raw child exit unavailable);
the retained metadata selection of a 625-case instead of 627-case input;
and the five-error TypeScript gate before the compatibility correction. The
second pre-correction full run was already active before the scheduling hold,
completed with exit 0, and was preserved. Final acceptance uses the new source
and fresh final gates, not earlier green results.

Evidence: `C:/Users/nooro/AppData/Local/Temp/monocode-cc/cc5el/evidence/`.
`corrected/frozen-source.json`, every gate's raw/full receipt, case inventories,
original transport observations, source snapshots and adaptation diffs bind
final proof. `full/` retains the merge phase and wrapper/compiler failures;
`upstream-cc5ekr/` preserves all 147 original artifacts byte-for-byte. REPORT.md
records source/documentation pins, hashes, cleanup and the complete attempt table.

No native/browser/preview/fan-out/live/profile work or push occurred. Incoming
native source matches the coordinator's validated H commit; those native
results were not rerun here. Claude owns the final storage review. The new
decision to turn direct project routing off by default belongs to a separate
round; no routing classifier/default changes were made here.

All assigned CC5EL builder gates are complete. Fresh independent final
authority review and root integration remain required; this is not SHIP.
Cross-renderer CAS, renderer-exit replay and live/native acceptance remain
outside the synthetic renderer issuance proof.
