# CC5D: durable Manager wake digests

CC5D batches worker reports and Manager-bound team messages through the existing
orchestration run store. Four staggered workers produce one completion digest;
twenty informational updates produce no Manager turns on their own. Decisions,
failures and approvals retain their existing authority and availability gates.

The code was built from `a6677f60325f98af4d139340da68a8746301bc99` on
`HenkDz/cc5d-manager-wake`. Implementation commits are
`d30a2c1c9a01faf74c34aca1aa28351361686a6f` and
`be97ee67d308d74ea8683c8b4ec29ef8cce64151`. The coordinator owns review and merge.

## Wave and event ownership

`managerWake.ts` contains the pure reconciliation, wake planner, digest builder,
receipt acknowledgment and scheduling code. Optional `OrchestrationRun.wakeState`
is persisted by the existing `control_save` JSON snapshot; no database migration
or independent event store is added.

A wave records its dispatch IDs, originating Manager turn, seal, deadline and
completion/timeout/retirement timestamps. `managerWakeTurnId` on the task retains
the creating turn when a capacity-limited launch is accepted after that turn
settles. Message/retry actions capture their current Manager turn. A fast child
cannot wake its Manager before the dispatching turn settles. Queued future
dependencies do not become wave members until actually dispatched.

The deadline is one persisted epoch timestamp, fifteen minutes from the last
accepted child. Acceptance means persisted dispatch authority, before preparation
or provider submission. A timeout reports remaining work once and leaves tools
running. Restart recovery carries the original deadline across retained-checkout
dispatch replacement. Pause/stop retire waves, and cancelling every child retires
its wave without a completion wake. Evidence remains stored. CC5DF releases
undelivered reports from retired waves when the run becomes active again;
cancelled reports remain quiet.

Runs and dispatches without a recorded Manager turn retain the existing report
delivery behavior until an explicitly tracked wave is created. Creating an info
outbox does not suppress a legacy completion, including version-1 tasks without
dispatch IDs. This also preserves existing untracked Habit behavior.

## Wake policy and delivery

Normal reports are held until every dispatched member of a sealed wave settles.
A successful prerequisite that needs Manager acceptance to unlock queued work is
a decision, so dependency gates cannot deadlock behind other workers. Explicit
decisions, escalations, failures and pending approvals have no deliberate delay.
Questions share a 250 ms window. The planner never classifies message prose.
CC5DF upgrades an unfrozen report when a dependency arrives after completion,
or adds one stable decision event when the report receipt is already frozen.

`team.message` validates optional `kind: info|question|decision|escalation` in both
the native CLI and frontend. `kind:info` and `requiresReply:false` remain quiet;
omitted kind/reply flags preserve legacy action-required messages. The team rules
tell agents to mark progress, acknowledgments and informational messages explicitly.
Direct worker questions retain their existing steering path and org routing.
Manager-bound messages are persisted to the run outbox before a crew-feed receipt
is recorded. The 500-entry crew feed remains a display feed.

Before target delivery, the run stores an immutable digest receipt with a stable
ID, event IDs and body. The receipt advances only after the target queue has been
saved and read back with its managed marker and request ID. New IDs use
`manager-digest-<uuid>`; exact legacy colon IDs remain readable as validated
managed receipts. Queue acceptance is serialized per owning conversation, including different
project engines sharing that conversation. A concurrent user update is rebased
before publication; existing queued message identities and metadata are retained.
Digest messages cannot steer into an active turn or bypass a pending approval.

Receipt replay checks queued items, loaded transcript blocks and existing archived
internal receipts. A failed or lost acknowledgment keeps the same receipt and
pending evidence. Stale async run snapshots preserve newer events, accepted child
IDs, deadlines and acknowledgment/retirement flags. No unacknowledged entry is
trimmed. Quota, storage, user input and existing continuation limits still gate
delivery. Acknowledging an earlier question digest rearms remaining wave deadlines.

Digests contain short result sections, task/goal/request identities and supported
artifact links to full reports. Without a saved report artifact, they include the
supported `app sessions.read` lookup for the retained worker chat.
All sections remain untrusted evidence and confer no new goal or merge authority.
CC4 delivery timestamps advance only when the matching digest turn starts; an
unrelated user turn cannot stamp worker reports as delivered.

## Existing status selector

CC4's `selectAgentLiveState` receives the owned runs' wake states through
`monoLiveState`. It supplies `Waiting for 2 workers · 3 updates held`, using its
existing blocker/activity/queue/pause precedence. Storage errors still outrank
held updates. Sidebar, member view, mission control and right-panel components
were not changed, and no second status calculation was introduced.

## Validation

Final frontend validation ran from clean commit
`be97ee67d308d74ea8683c8b4ec29ef8cce64151` on Windows, Node `v26.5.0`, with
`NODE_OPTIONS=--no-experimental-webstorage` for every command.

| Check | Result |
| --- | --- |
| `rtk proxy npx --no-install vitest run --maxWorkers=8` | 6,354 passed, 13 skipped, 0 failed, 0 todo; 6,367 total. 563 passed files, 2 skipped, 0 failed; 565 total. Exit 0; Vitest 59.54 s, wall 61.660 s. |
| `rtk proxy npx --no-install tsc --noEmit` | Exit 0; 24.656 s. |
| `rtk proxy npm run build` | Exit 0; 47.460 s; Vite 21.94 s. |
| `rtk proxy cargo test control_cli::tests` | 24 passed, 0 failed, 0 ignored, 652 filtered; exit 0. Matching tests 1.26 s, wall 163.102 s including compilation. |
| `rtk git diff --check` | Passed. |

The 39 reducer/scheduler tests and 18 engine integration tests cover early
completion, staggered workers, quiet info, question coalescing, immediate alerts,
prerequisite acceptance, one timeout, restart/deadline restoration, user races,
quota/storage failures, lost receipts, shared-owner writes, stale snapshots,
cancellation and legacy runs. These focused counts are included in the full suite.
Native validation ran after the CLI-kind change; that Rust file was unchanged
through both implementation commits. Only the touched Rust file was formatted.

Evidence is under `C:/Users/nooro/AppData/Local/Temp/monocode-cc/cc5d/evidence/`:
`final/` contains logs, JSON and command receipts for the final clean commit;
`native/` contains the focused Cargo log and metadata. `d30a2c1/` preserves the
earlier passing full run. `baseline/` preserves an initial mixed-state run with
6,274 passed, 13 skipped and 11 failed tests: contract tests were added while it
was collecting, so it is not a valid unchanged baseline. Ordinary local `npm ci`
installed missing dependencies without force flags or package/lock edits.

Existing build warnings remain: two CSS `::highlight` warnings, the mixed
dynamic/static Mono import warning and the large-chunk advisory.

## Expected effect and follow-ups

The measured baseline had 37 reactive Manager turns: 25 worker-report reactions
and 12 team-message reactions, costing 47–108 seconds and 0.3–0.8 million input
tokens each. Grouping eligible reports into waves and explicitly labeling routine
messages removes redundant reactions while retaining real questions and gates.
For illustration, 25 independent reports grouped into stages of four need about
seven completion digests; real decisions, failures and timeouts add permitted
wakes. The program target of at most twelve worker-triggered turns on equivalent
37-reaction work is an expected-effect target, not an achieved live measurement.

No live model turns, preview, real profile writes, push, merge or deployment were
performed. Live provider/UI acceptance and the historical workload measurement
remain for an authorized coordinator run. Saved report artifacts supply clickable
full-report links; a missing artifact uses conversation lookup. Long-lived runs
retain acknowledged evidence as well as pending evidence; any later archival must
preserve durable request signatures and never remove unacknowledged events.
CC5-F review-fork automation and CC5-E rotation/task-sizing changes remain outside
this round.

## CC5DF corrections

CC5DF fixes all five CC5DR findings: persisted queue markers and receipt IDs,
Continue releasing held reports, autonomous backoff after target save/lookup
failure, acceptance decisions for late dependencies, and bounded digest pages.
The third delivery failure appears through CC4's existing storage blocker; retry
state follows the selected immutable receipt across stale snapshots. New digest
pages contain at most 4,000 characters, put action items first, retain full-message
references through `control list`, and acknowledge only represented evidence.

Current combined validation, exact commits and evidence are documented in
[`cc5df-manager-wake-fixes.md`](cc5df-manager-wake-fixes.md). The validation numbers
above describe the original CC5D build, before CC5DR identified these defects.
