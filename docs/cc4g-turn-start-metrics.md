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
to delayed dispatch settlement. Canonical state, reasons and counters are retained.

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

Corrected focused validation is pending at this source freeze. Full Vitest,
TypeScript and production build await an explicit sole validation slot under
VALIDATION-QUEUE.md; CC5C-L currently owns FULL. Browser/current dark/light/narrow
proof may run only if separately assigned. No native delta requires Cargo.
Source/server-render checks do not establish pointer, browser or native behavior.

Evidence root: C:/Users/nooro/AppData/Local/Temp/monocode-cc/cc4g/evidence/.
Original red runs: original-ec6005/, original-735455a-corrected-import/,
integrated-before/. Initial wrapper syntax failure and the baseline import failure
are retained separately; they produced no completed product test totals.
