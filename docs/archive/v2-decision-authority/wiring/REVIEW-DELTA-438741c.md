# Corrected frozen pin — CC5D namespace preservation

HEAD `438741ca7874407ca72dc9811002d9814bb2bf27`, tree `2927abe9ff5cc261962b31de97c4de5657a50480`, clean checkout. This supersedes c993d69/ad526f9 as the final review/gate target; all earlier pins, manifests and raw evidence are preserved. Root authorized this narrow correction in msg_f7de7a657089. Full suite has never started on the previous wired pins; no source was edited during a gate.

Issue found by source audit while RAM floor held: generic CC5D prerequisite acceptance also uses IDs such as `decision:report:<dispatch>`. The V2 guard's broad `startsWith("decision:")` would look for these ordinary events in the V2 ledger, fail and potentially retire them. The new `isMonoDecisionEventId` recognizes the complete reserved V2 ID shape (`decision:<decisionId>:<version>:<question|escalation|decision>:<chain index>`). This is classification only: exact retained source membership/event body/signature, authenticated owner, current decision version and all original work/binding/generation guards remain necessary for actual V2 delivery. Unknown IDs of the V2 shape still fail closed; syntax creates no action authority.

All affected classification paths changed together: App Manager digest acceptance and actual queue consumer, stale digest retirement filter, monoDecisionDelivery digest validation, and Orchestrator's internal explicit retirement membership. Ordinary current CC5D digests can still use legacy runs without a Mono owner. Every queued Manager digest must match its retained receipt ID/app ID/body before classification, so a missing/replaced receipt cannot bypass validation. Generic stale-snapshot reconciliation is unchanged in this correction.

Eight changed paths relative to c993d69:

- `src/app/App.tsx`: exact Manager receipt preflight and V2-only classification/retirement.
- `src/app/App.decisions.test.ts`: actual App acceptance/consumer regression for ordinary prerequisite decisions, legacy owner, changed receipt/body held. Existing source/persistence assertions remain.
- `src/features/monos/model/monoDecisions.ts`: complete V2 event-ID classifier.
- `src/features/monos/model/monoDecisionDelivery.ts`: apply classifier before strict existing V2 source checks.
- `src/features/orchestration/model/orchestration.ts`: retirement accepts only retained IDs in V2 shape.
- `src/features/orchestration/model/orchestration.test.ts`: stale V2 test IDs now use the real reserved shape; ordinary retirement rejection and unrelated-report retention assertions unchanged.
- `tests/browser/ccvision-v2.tsx`: bind the actual App classifier in the source-selected fixture scope.
- `tests/browser/ccvision-v2.spec.ts`: capture a dedicated trusted-keyboard autonomy focus frame (assertions/deadlines unchanged).

Affected gate `wired-focused-20261019T172228Z` passed after the main classifier change, before the final receipt-identity assertion and focus-frame addition. Final exact-pin affected/browser/tsc/build/full gates remain pending; previous c993 browser5/tsc/build results are inherited evidence only for this corrected source. Historical regression replay extracts the exact old function from preserved c993d69 (no checkout mutation) and intentionally asserts ordinary prerequisite delivery succeeds; the expected old-source assertion failure must be preserved separately. Its first start was held below the 3GiB floor before Node launch; no failure result has yet been claimed. Script `historical-cc5d-collision.cjs` and `wired-gate.ps1 -Name historical` capture that exact source SHA/pin/raw failure under the same sequential B/fresh-RAM rules.

Subsequent historical replay DID run under a valid RAM start: `wired-historical-20261019T172732Z`, expected exit1. It extracts only the exact c993 guard, SHA256 `889b90191d59082641de8a411e3a5550010a7db03b0a10946f6de18384af47ea`, and preserves `AssertionError: Got unwanted exception / Manager digest decision evidence is stale or unavailable` for the ordinary prerequisite receipt. This is an intentional old-source failure, not a current-candidate passing gate or a claim that a Node wrapper failed. The corrected-pin focused gate is in progress.

`MANIFEST-438741c.json` binds all 33 accepted-V1 changed paths and their SHA-256 values. No Rust/native path changes; serializer, exact off-page Boss readback, protocol, recovery, Stop and UI contracts from ACTUAL-WIRING-SUPPLEMENT-20261019.md remain in scope. Please bind final existing Claude and independent source/runtime/UI verdicts to this corrected pin, preserving any prior review findings. Capacity holds do not authorize override, concurrent B streams or foreign-process actions. Root remains sole integrator/release owner; completion and clearance are not claimed.
