# CC4G: assignment elapsed requires a recorded conversation turn

MemberWorkLog no longer uses dispatch acceptance or settlement timestamps as
conversation elapsed. The existing selectTaskMetrics selector supplies the
displayed dispatch's clock. Task counters retain their existing retry aggregation,
input convention, cache subtotal and unavailable-counter behavior. A previous
attempt's start cannot become the clock for a newly accepted dispatch.

TaskMetricsLine requires a canonical recorded start before showing elapsed, even
when a caller supplies timestamps. With no observed turns it shows Conversation
not started; a recorded turn without its start stays Elapsed unavailable. An
observed running turn continues ticking, including a start at zero. A completed
turn uses its recorded elapsed duration, including zero, rather than extending
to delayed dispatch settlement. The existing formatter still rounds subsecond
durations to a visible 1s; the underlying zero start/duration/end remain zero.
Explicitly selected retry clocks retain their existing override behavior.
Canonical state, reasons and counters are retained.

No dispatch timestamp is invented or changed. There is no new store, clock,
scheduler, preparation-stage exception list, dependency or layout. The necessary
boundary changes are limited to MemberWorkLog and TaskMetricsLine; selectors and
orchestration production code remain unchanged.

## Integration

The named branch starts at validated 0100aae743b3062fcbd3492449ac5cb14b74711c.
It locally merges the explicitly authorized Workbench candidate
ec6005fdfa33f51ca001dd4a89c877afade138d3 as
0f6367fc89ae93f254654948adcf50b8e0680cfb. The one storage-notice title conflict
retains the current sandbox-unavailable guard and Workbench wording. Other incoming
guards and the full Workbench are preserved. This merge is only into this builder's
branch; integration into nour and release remain the coordinator's responsibility.

## Validation checkpoint

The original source/server-render probe is preserved. Source-import path adaptation
only selects this checkout or exact Git objects; original checks and expected-safe
assertions remain unchanged. Each original candidate, baseline WorkLog, and merged
pre-fix run reports 16 passed / 2 failed / 0 skipped. The accepted attempt renders
1m and the failed settled preparation renders 3s without a recorded turn start.
Raw red output remains in the evidence folders.

Added focused tests use real Orchestrator dispatch creation, observed turn events,
settlement, saved snapshots and hydration with a synthetic host/store. They cover
accepted/starting, failed settlement without start, observed time zero, recorded
completed duration despite late settlement, persisted legacy unknown starts and
changed current goal/session identity. Shared line tests preserve zero counters and
reject unsupported caller clocks. Existing metric/state/header regressions remain.

Corrected source is frozen at 0b3f61b7412147ea095c41e0adb6273cdff4859a.
The corrected original probe passes 18 / 0 failed / 0 skipped with its original
expected-safe assertions and baseline witnesses unchanged. Its baseline WorkLog
uses the corrected shared TaskMetricsLine; exact original base and candidate red
runs remain separate. Five focused Vitest files pass 69 / 0 failed / 0 skipped,
including ten new regressions. Both current runs preserve all 1,726 tracked
non-documentation input hashes before/after. The Workbench browser spec is unchanged.

Full Vitest, TypeScript and production build await an explicit sole validation
slot under VALIDATION-QUEUE.md; CC5C-L currently owns FULL. Focused tests use
read-only installed Workbench dependencies through an external resolver adapter;
no dependency install, symlink or other-tree write occurred. One worker,
NODE_OPTIONS=--no-experimental-webstorage and synthetic homes were used. Browser/
current dark/light/narrow proof may run only if separately assigned. There is no
native delta; no Cargo run is claimed. Source/server-render/happy-dom checks do
not establish actual pointer, browser or native behavior. Final independent UI
review and every required full gate remain open; this is VALIDATION-READY only.

## Retained attempts

The first focused attempt completed 31 tests / 0 failed but four files failed
to load because of an external icon-export resolver error (overall exit 1).
The next completed 47 passed / 1 failed, with two additional mermaid import/load
errors. The new zero-display expectation was corrected to the existing formatter
contract, retaining an exact selector assertion for duration zero. New integration
fixtures then exposed unsupported memberId (61 / 7), missing required member name
(61 / 7), and an incomplete PR-cache mock (62 / 6). Each failed run is retained.
The complete supported delegation envelope and partial house-cache mock now run
the real production boundaries. The intermediate corrected run passes 68 / 0;
the final run adds the completed-retry override regression and passes 69 / 0.
Original tests, safe assertions, deadlines, retries and skips were not relaxed.

Evidence root: C:/Users/nooro/AppData/Local/Temp/monocode-cc/cc4g/evidence/.
Original red runs: original-ec6005/, original-735455a-corrected-import/,
integrated-before/. Corrected gates: corrected-final/ and focused-final/, with raw
logs, JSON and source manifests. source-audit.json records incoming guard/native/
scope preservation; integrated-app-seam.diff records the authorized App merge seam.
Initial wrapper syntax, baseline import and audit-adapter failures are retained
separately; they produced no completed product/audit totals. REPORT.md and
VALIDATION-READY.md in the round folder record the pending slot and final binding.
