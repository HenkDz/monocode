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

## Limits

No live model turn, native desktop preview, deployment, push, merge into `nour`,
other-worktree mutation or real profile/database changes. Synthetic checks
establish source behavior; native runtime acceptance and latency improvements
remain coordinator rollout checks. Existing hidden provider additions,
attachments and indivisible long turns remain outside the text projection.
