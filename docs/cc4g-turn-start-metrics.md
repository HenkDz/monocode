# CC4G: assignment elapsed requires a recorded conversation turn

## Current CC7UR corrections: source ready, FULL pending

The resumed branch merged exact validated nour
ec1250de4f0abc0af781485ed581aa0cc81bff7d, conflict-free, as
0410b4bf7fd86e623b1ffc33893a7cf447186f5a. Before corrections its application/source/test inputs matched the
independently rejected prospective G+H8fcdc178. No authored App/notice resolution
was necessary; incoming H diagnostics/sandbox, authority, binding, rotation,
routing and private-config guards remain. Latest source is
b4b28013627873c83bb69ed16df6c6b0f3111ced, after corrections733600b and the
observed-clock fixture correctionb4b2801.

- F1: the Workbench drawer wrapper resets the individual CSS translate in
  addition to transform. Modal still owns trapping, Escape and return focus.
- F2: zero observed turns only implies Conversation not started when the
  selector reports complete metrics. Partial running/settled history keeps
  Elapsed unavailable. Recorded starts, zero values and counters are unchanged.
- F3: the synthetic host implements required integrateWorker/cleanupWorker with
  their supported returns. MonoTeamActivity's existing user turn now records a
  genuine synthetic10s clock; original10s and feed-count assertions stay intact.
- F4: the shared full-output pre opts into text selection with the existing
  select-text utility; body selection suppression remains.
- F5: a retired reader task clears its selection and focuses the existing active
  assignment filter. Another Manager reusing the ID cannot reopen that reader.

Seven focused files pass84 /0 failed /0 skipped; the unchanged original18
source/server probes pass18 /0 /0; both CC7UR unknown-clock controls pass2 /0.
All1730 tracked non-documentation hashes match before/after each current gate.
The first corrected focused attempt remains83 /1: a newly linked fixture
dispatch added two feed events. Recording the synthetic clock on the existing
user turn corrected the fixture while retaining every old assertion. No old
timeout, retry, skip or safe expectation was weakened. Only this round's new
failed-settlement test changes its label expectation to unavailable, consistent
with that settled selector's partial history and the original18 safe contract.

Ten additional browser cases are prepared for both engines: six dark/light
wide/narrow cold drawer cases with pointer copy actions and screenshots, two
saved-output glyph-selection cases, and two retired/reused-identity focus cases.
The original Workbench spec is byte-identical to the review; its719-line prefix
is unchanged. These new browser cases have not run. Actual screenshots and
pointer/browser acceptance remain pending, as do full unit/type/build gates.

The tab-revisit test/fixture, wordFade, AgentMarkdown, AgentTranscript and global
CSS are byte-identical to exactec6005. The known WebKit extra fade remains an
unresolved browser failure: this equality is preparation for an unchanged
baseline replay, not a waiver. FULL must run both exact baseline and current
tab-revisit controls with original assertions/deadlines/retries/skips. Keep the
known BlobMP4 failure visible and baseline-bound. No animation correction has
been guessed from source inspection.

User's latest scheduling is FULL A=EL/B=I; this branch has SOURCE/SMALL authority
until explicit reassignment. No installs, full suite, tsc, production build,
browser/server/preview, Cargo/native or fan-out was started during the resume.
Focused checks reuse installed dependencies read-only through the retained
external resolver with one worker, isolated homes and the required Node flag.
Storage/remedies belong I, steer/handoff EL, routing-default disablement CC5RO.
No push or integration into nour occurred. Independent final acceptance remains.

Current evidence is under cc4g/evidence: corrections-focused-01/ (failed),
corrections-focused-02/ (84/0), corrections-original18/ (18/0),
corrections-unknown-clock/ (2/0), corrections-source-audit.json and the adapted
small-run wrappers. REPORT/VALIDATION-READY bind the current clean candidate.
All earlier failures/results below remain historical and are preserved.

## Retained original source checkpoint

MemberWorkLog no longer uses dispatch acceptance or settlement timestamps as
conversation elapsed. The existing selectTaskMetrics selector supplies the
displayed dispatch's clock. Task counters retain their existing retry aggregation,
input convention, cache subtotal and unavailable-counter behavior. A previous
attempt's start cannot become the clock for a newly accepted dispatch.

TaskMetricsLine requires a canonical recorded start before showing or ticking elapsed,
even when a caller supplies timestamps. With no observed turns and complete metrics
it shows Conversation not started; partial history or a recorded turn without
its start stays Elapsed unavailable. An
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

Corrected source is frozen at cf9d2a509ced8c9a1523f414bf693f5b7c614ea5.
The corrected original probe passes 18 / 0 failed / 0 skipped with its original
expected-safe assertions and baseline witnesses unchanged. Its baseline WorkLog
uses the corrected shared TaskMetricsLine; exact original base and candidate red
runs remain separate. Five focused Vitest files pass 70 / 0 failed / 0 skipped,
including eleven new regressions. Both current runs preserve all 1,726 tracked
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
the next run adds the completed-retry override regression and passes 69 / 0.
The final clock-gate run also verifies no timer before recorded start and an
actually ticking zero start, and passes 70 / 0.
Original tests, safe assertions, deadlines, retries and skips were not relaxed.

Evidence root: C:/Users/nooro/AppData/Local/Temp/monocode-cc/cc4g/evidence/.
Original red runs: original-ec6005/, original-735455a-corrected-import/,
integrated-before/. Current gates: corrected-clock-gate/ and focused-clock-gate/, with raw
logs, JSON and source manifests. source-audit.json records incoming guard/native/
scope preservation; integrated-app-seam.diff records the authorized App merge seam.
Initial wrapper syntax, baseline import and audit-adapter failures are retained
separately; they produced no completed product/audit totals. REPORT.md and
VALIDATION-READY.md in the round folder record the pending slot and final binding.
