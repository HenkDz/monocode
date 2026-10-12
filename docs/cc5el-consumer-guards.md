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

## Source-stage validation

Windows/Node 26, `NODE_OPTIONS=--no-experimental-webstorage`, one worker.
Source families were split into individual-file sequential probes; no FULL
job was started while CC0-H owns the sole slot.

| Family | Passed | Failed | Skipped/todo |
| --- | ---: | ---: | ---: |
| Untouched-base original three safety cases | 0 | 3 | 0 |
| Corrected original three | 3 | 0 | 0 |
| Retained lifecycle / contract / binding / independent | 37 / 9 / 9 / 9 | 0 | 0 |
| New connected caller regressions | 32 | 0 | 0 |
| Original connected providers/App/registry, 19 files | 693 | 0 | 0 |
| Historical source, 24 files | 639 | 0 | 0 |
| Historical external, 13 files | 129 | 0 | 0 |
| Writer / entry / migration / shared preflight | 6 / 5 / 3 / 10 | 0 | 0 |
| E/F/G A/B/C runners | All three exit 0 | 0 | 0 |

The 101 original lifecycle assertion statements remain, with the approved
102nd zero-HTTP observation assertion. All 37 original lifecycle names and
639 historical source names match. Counts overlap and are not unique coverage.

New cases execute source-extracted production App callbacks, the actual
registry queue/helper and actual OpenCode adapters with synthetic HTTP. They
cover late newer/deleted/unknown/unreadable carry, generation and Stop at the
registry queue and after v2 model/agent configuration; accepted requests;
provider failures; busy/tool/stream/binding/canonical state; guidance draft
ownership; unchanged helper approvals, questions, timeout and fallback.

Retained failed attempts remain visible: the independent fixture initially
reported 7 pass/2 fail from a new error-message mismatch, corrected by using
the existing dispatch message; two new v2 fixture attempts reported 20 pass/
12 fail and six unhandled startup rejections each because the synthetic
version/service responses were incomplete. Corrected fixtures pass 32/0 with
unchanged assertions and deadlines. The baseline runner also encountered a
console encoding error after its valid failure log/JSON/receipt were saved.

Evidence: `C:/Users/nooro/AppData/Local/Temp/monocode-cc/cc5el/evidence/`.
`source-start.json`, `source-freeze.json`, `source-small-summary.json`,
`executed-case-inventory.json`, `caller-inventory.json`, raw `*-results.json`,
`*-receipt.json`, logs and observations retain exact source/config/fixture
hashes and before/after transport proof. `upstream-cc5ekr/` preserves every
upstream artifact byte-for-byte; path and scope adaptations are separate diffs.
`REPORT.md` records the commit pins and pending gate inventory.

## Pending acceptance

Source/small readiness does not complete CC5EL or grant SHIP. The coordinator
must supply a new exact validated H main and explicitly grant FULL. Merge that
pin into this own branch, preserve incoming H and Workbench/metrics guards,
refreeze, then run complete one-worker Vitest, TypeScript and production build
sequentially. No native delta requires unrelated Cargo. Any source correction
invalidates the relevant gates. A fresh independent corrected-head authority
review remains required after integration.

No native/browser/preview/live-provider acceptance is claimed. Cross-renderer
localStorage CAS, renderer-exit replay and real transport acknowledgments remain
outside these synthetic renderer issuance proofs.
