# CC5EF: context refresh retry and visibility fixes

CC5EF merges CC5E into its own branch on the current `nour` snapshot and
repairs all four CC5ER findings. The SessionPane conflict keeps CC4 metrics
and CC7B's member work layout, adding refresh state to the existing composer.

## Changes and decisions

Every unaccepted startup input remains in the pending carry. Retries collect
later visible user constraints and save before detaching or starting again.
The 8,000-character protected allowance and 14,000-character complete-brief
allowance apply to retries too. A pending carry that exceeds either allowance
stops submission with an explanation, preventing an empty replacement thread
from receiving a request without its earlier restrictions. Acceptance clears
the pending inputs; the app transcript and protected user requests remain.

One planner supplies both submission and UI status. Retained task context
stays verbatim until that planner checks the allowance, allowing oversized
assignments, scopes and references to produce a reason instead of disappearing
into an undefined result. Both composer surfaces use the current draft.
Primary Mono chats reuse ContextMeter for scheduled refresh, unknown limits,
deferrals and manual context actions, including pending carries without usage
telemetry after detachment. Context actions retain operation guards.

Coordinator steering in `upstream-2026-10-11.md` requires one Mono meter in
the incoming upstream controls slot below the composer. The rotation and
deferral labels stay as props on that meter; there is no above-input meter.
UP1 should retain those props when adding upstream's model controls, keeping
one meter per Mono pane. Upstream itself is not merged in this round.

Context/configuration events carry the submitted profile identity through
the event queue. Reduction rejects stale limits and configuration after a
model/settings selection change while preserving occupancy, output, metrics
and compaction events. Canonical provider configuration advances the emitting
profile so its following updates remain usable. Rewind and manual compaction
use the same event binding.

Rejected alternatives: dropping failed inputs after the first error, silently
truncating constraints, increasing the established allowances, guessing model
limits, cancelling the active turn on a picker change, filtering only before
event enqueue, and replacing the newer member layout with the older CC5E pane.

## Reproductions and evidence

- `App.rotationRetry.test.tsx` exercises the actual App save/deferral guards.
- `monoRotation.test.ts` covers the A/B/C failed-start sequence, absent
  transcript blocks, retry bounds, high-occupancy deferrals and draft growth.
- `memberContinuity.test.ts` preserves oversized assignment/scope data until
  the shared planner explains its deferral.
- `App.contextRotation.test.tsx` exercises actual picker/settings/event
  callbacks, queued stale limits, canonical configuration, and CC4 metrics.
- UI tests exercise ContextMeter, MonoComposer and SessionPane surfaces.

Baseline and review:
`C:/Users/nooro/AppData/Local/Temp/monocode-cc/FINDINGS.md` and
`C:/Users/nooro/AppData/Local/Temp/monocode-cc/cc5er/REPORT.md`.
Repair receipts and logs:
`C:/Users/nooro/AppData/Local/Temp/monocode-cc/cc5ef/validation/` and `evidence/`.
Branch revision and final check counts are recorded in that round's `REPORT.md`.

## Validation

Windows, Node 26.5.0; all web checks used
`NODE_OPTIONS=--no-experimental-webstorage`. Source revision: `83a667d`.

| Check | Result |
| --- | --- |
| Full `npx vitest run --maxWorkers 4` | 573 files passed, 2 skipped, zero failed; 6,542 tests passed, 13 skipped, zero failed; 108.42 s runner |
| `npx tsc --noEmit` | Exit 0, no diagnostics; 32.647 s wall |
| `npm run build` | Exit 0; 3,680 modules, 33.91 s Vite, 76.024 s wall |
| Native `cargo test --manifest-path src-tauri/Cargo.toml --lib control_cli::tests -- --test-threads=1` | 23 passed, zero failed/ignored/measured, 669 filtered; 23.487 s wall |
| Focused retry/planner/context/continuity | 4 files, 49 tests passed, zero failed/skipped |
| Focused profile/event/metrics/cancellation | 7 files, 233 tests passed, zero failed/skipped |
| Focused actual composer/meter/pane | 4 files, 101 tests passed, zero failed/skipped |

The first full run failed one unchanged CRLF editor test's 5-second timeout
under concurrent compilation: 572 files passed, 2 skipped, 1 failed; 6,541
tests passed, 13 skipped, 1 failed. Its four tests passed unchanged alone,
then the complete suite passed without concurrent compilation. Initial UI
tests had six failures because their synthetic fixture had not registered
harness capabilities; the fixture was corrected without weakening production
guards. A preliminary TypeScript check found two new test-fixture annotation
errors; those were corrected before the final clean check. Attempt receipts
and explanations are preserved in the round's validation/evidence folders.

The final documentation commit keeps all validated application/native source
trees, package files and embedded delegation guidance identical to `83a667d`.

## Limits

No live model turn, native desktop preview, deployment, push, merge into `nour`,
other-worktree mutation or real profile/database changes. Synthetic checks
establish source behavior; native runtime acceptance and latency improvements
remain coordinator rollout checks. Existing hidden provider additions,
attachments and indivisible long turns remain outside the text projection.
