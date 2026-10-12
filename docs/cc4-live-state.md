# CC4: live agent state and turn metrics

Original CC4 branch: `HenkDz/cc4-live-state` at `32b62c5`.
CC4F integration branch: `HenkDz/cc4f-live-state-fixes`, starting from CC0/CC0-F
integration `5801602`; CC4 was merged locally as `ee74f1c`.

CC4 gives Command Center consumers a shared state selector and persisted turn
accounting. Sidebar labels expose storage blockers, queues, approvals, compaction
and delegation waits. Task cards show elapsed time, recorded tokens and state.
The existing task lifecycle and PR actions continue to describe review and merge
progress separately from provider activity.

## Live state contract

`src/features/agents/model/agentLiveState.ts` exports
`selectAgentLiveState(session?, context?)`, `agentLiveStateLabel` and
`agentLiveStateTooltip`. `AgentStatusLabel` renders the canonical label with its
reason in a tooltip. The pure selector accepts the existing session fields and
optional `{ task, tasks, runStatus, pauseReason }` orchestration context.

```ts
type AgentLiveStatus =
  | "thinking" | "running-tool" | "compacting"
  | "waiting-review" | "waiting-on-member" | "queued"
  | "blocked" | "needs-you" | "idle" | "done" | "failed";

type AgentLiveState = {
  status: AgentLiveStatus;
  reason?: "storage" | "usage-limit" | "approval" | "decision" | "error"
    | "preparing-storage" | "paused" | "editing" | "handoff" | "worktree"
    | "dependency";
  detail?: string;
  waitingOn?: string;
};
```

Current storage errors and decisions outrank activity and queued work. Provider
activity outranks historical task results. A storage error with a queued message
returns `{ status: "blocked", reason: "storage", detail: codexStorageError }`,
displayed as **Blocked · storage**. Storage preparation displays **Queued ·
waiting for storage**. An idle Manager with an active review task displays
**Waiting on Reviewer** (or the reviewer's saved name).

The existing coarse `MonoState.status` remains available to callers that use it
for activity styling and routing. Its optional `liveState` contains the detailed
state. Consumers should use the detailed selector for status text.

CC4F removes CC0's competing `storageBlocked` display fields. Sidebar and project
rows, session cards, the member header and compact picker consume the same
canonical label. Card publication uses the same roster state as the member
header, including its current worker when the durable member chat is idle.
The outbox also receives `liveState`; storage errors and preparation hold its
messages and hide steer/resume actions while allowing edit/remove. CC0 recovery
hooks, account issue grouping and the inline recovery card remain in place.

Tool and failure scans stop at `currentTurnIndex`, the submitted user block with
`startedAt`, skipping drafts, queued bubbles and mid-turn steering. A current
provider error is checked before a generic queue pause; a retry's new submitted
turn excludes the preceding error. Roster decision roll-up preserves an agent's
existing canonical blocker.

When a queued bubble is accepted as a new turn, it retains its identity and
original `sentAt` and moves after the preceding turn's final reply or failure.
Mid-turn follow-up acknowledgements keep their position. No transcript history
is deleted. Restored untimed history uses the last nonqueued, nonsteering user
boundary when no timed owner is available. Member state feeds a current worker's
storage error into the same selector so that a durable-chat question cannot hide
its storage blocker.

Existing row buttons describe reasons and additional task counters through
`aria-describedby`. The existing `Popover` shows that description on focus or
hover without adding a tab stop or nesting another button. Old card snapshots
without `liveState` retain their previous coarse fallback.

## Turn capture and persistence

`src/features/agents/model/turnMetrics.ts` captures normalized `HarnessEvent`
fixtures through the shared event reducer. The existing user block owns the
turn: `Block.startedAt` is the submitted start and `Block.durationMs` the settled
duration. Steering messages and unsubmitted outbox messages are not new turns.
`Block.turnMetrics` extends the existing provider token accounting:

```ts
type TurnMetrics = {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  cacheHitPercent?: number;
  firstTokenAt?: number;
  endedAt?: number;
  modelCalls?: number;
  modelCallIds?: string[];
  compactions?: { id?: string; startedAt?: number; endedAt?: number }[];
};
```

Times are epoch milliseconds. First token means the first nonempty assistant,
reasoning or plan text observed by the app; it does not imply first visible
assistant prose. Compaction start and completion can be observed independently.
Counters without provider evidence remain absent. Per-turn counters preserve
provider semantics: Codex input includes cache reads; the other harness adapters
report uncached input separately. Pi request accounting is emitted only for a
completed assistant `message_end` with a stable identity; its following
`turn_end` does not replace the accumulated requests. Context-meter updates
remain independent. Cache percentage is recomputed from aggregate input/read/
write counters whenever the denominator is positive, including zero uncached
input. Accepted outbox turns receive their end timestamp using the same submitted
turn ownership rule, even when the bubble retains its original `sentAt`.

The existing `blocks_json` session persistence stores these fields without a
database migration. `Session.compacting` is transient and is cleared when the
turn settles or the session is restored. Historical turns remain readable;
missing old counters are not backfilled from transcript text.

## Roll-ups and delegation timeline

`src/features/agents/model/agentMetrics.ts` exports:

```ts
selectAgentMetrics(session, now?): AgentMetrics;
selectTaskMetrics(task, dispatches, sessions, now?): AgentMetrics;
selectGoalMetrics(goal, runs, sessions, now?): AgentMetrics;
selectDelegationEdges(goals, runs, sessions): DelegationEdge[];
```

`AgentMetrics` contains `turns`, `elapsedMs`, optional `startedAt`,
`firstTokenAt`, `endedAt`, token counters, `modelCalls`, `compactions` and a
`partial` flag. `elapsedMs` sums observed turn durations and elapsed time for the
active turn; inactive history with a missing end contributes no invented
duration and is marked partial. Aggregate `endedAt` is absent when a selected
turn has no known end. The task card's
elapsed label describes its displayed dispatch, using the existing selector's
recorded turn start and duration. Dispatch acceptance, preparation, settlement
and goal timestamps are not conversation clocks. No observed turns with complete
metrics shows Conversation not started; partial running, settled or historical
metrics without a retained clock stay Elapsed unavailable. Recorded starts and
durations at zero remain valid. Task
counters can include retries while the displayed clock belongs only to the selected
dispatch; a previous goal or attempt cannot supply its start. Missing counters remain absent;
partial totals are marked as recorded metrics. Selectors deduplicate user-turn
identities, include retry dispatches and keep unrelated session turns out of
tasks with an exact turn reference.

Aggregate `inputTokens` uses `inputTokenConvention: "total-including-cache"`:
total input including cache reads and writes. Normalization uses each block's
saved `turnModel.harness`: Codex adds cache writes to its reported input; other
harnesses add reads and writes. The displayed cached counter is a subtotal of
this total input, so consumers must not add it again. Request-level counters
are unchanged. Dispatch snapshots retain `turnModel` and their raw convention
(`"includes-cache-read"` or `"excludes-cache"`), so provider replacement or an
unloaded conversation cannot change the aggregate. Legacy snapshots missing
provider provenance leave input unknown and mark totals partial rather than
guessing from the current session or task provider.

Existing `MonoManagerGoal.id`, manager message `monoSource.goalId`,
`OrchestrationTask.monoGoalId`, run owner and dispatch session IDs link
Grand Orch → Manager → worker. `managerTurnBlockId` links a worker assignment to
the Manager turn that created it; review tasks inherit their target's goal.
Dispatches gain optional `dispatchedAt`, `turnStartedAt`, `firstTokenAt`,
`finishedAt`, `reportedAt`, `turnBlockId` and `reportedTurnBlockId`. Existing
`startedAt` keeps its original meaning. A metrics snapshot on the dispatch
retains worker totals while its transcript is unloaded.

Reporting timestamps describe observed delivery to the Manager, distinct from
worker completion. Shared Manager report turns count once within a goal. When
one turn reports several goals, its full observed cost belongs to each linked
goal; do not sum independent goal totals as a global total. Historical records
without a captured boundary leave that timestamp absent.

For example, CC3 can select edges, group them by `goalId`, then draw each worker
from `dispatchedAt` through `startedAt`, `firstTokenAt`, `finishedAt` and
`reportedAt`. An absent timestamp is unknown, never zero latency. Edge
`managerId` is the project engine (`run.leadId`, matching `goal.managerId`);
`managerMonoId` and `managerSessionId` identify its optional roster and chat
counterparts. Historical completed task cards use the saved dispatch update for
their elapsed display when a captured finish boundary is unavailable; this does
not populate an invented `finishedAt` in the timeline data.

## Validation and evidence

Final CC4F Windows / Node 26.5.0 validation uses
`NODE_OPTIONS=--no-experimental-webstorage` throughout:

| Check | Result |
| --- | --- |
| Full Vitest suite (`npx vitest run --maxWorkers=8`) | 554 files: 552 passed, 2 skipped, 0 failed; 6,109 tests passed, 13 skipped, 0 failed, 0 todo; 6,122 total |
| `npx tsc --noEmit` | Passed |
| `npm run build` | Passed |
| `git diff --check` | Passed |

The worker cap limits concurrent test processes without filtering or skipping
tests. The first CC4F full run recorded 6,107 passed, 2 failed and 13 skipped:
two connected UI tests expected the old coarse `Working` label. They now assert
the canonical `Running tool` and `Thinking` labels. Original full-run results
remain under `evidence/first-run/`. Focused provider checks passed 87 tests;
roll-up checks 148; UI checks 30; root queue/state checks 77. These overlapping
runs are not added to the full-suite total. The independent queue recheck passed
nine assertions across four scenarios.

The production build retains two CSS `::highlight` warnings, the mixed
dynamic/static Mono import warning and the large-chunk advisory. Native files,
host code and dependencies are unchanged, so focused Cargo tests were not
required. Fixtures use synthetic sessions and provider events. No live model
turns, preview or user profile writes were performed. The authorized CC4 merge
is local to the CC4F branch; `nour`, other worktrees and remote branches were
not changed.

CC4F evidence is under
`C:/Users/nooro/AppData/Local/Temp/monocode-cc/cc4f/evidence/`: `validate.ps1`,
`validation-summary.json`, `vitest.json`, `vitest.log`, `typescript.log`,
`build.log`, command receipts, focused logs/JSON, `initial-checks.md` and
`state-review-repro-fixed.log`. `cc4f/REPORT.md` contains commit SHAs, changed
files, decisions, exact numbers and risks. Original CC4 evidence remains in
`../cc4/evidence/`; the independent review is `../cc4r/REPORT.md`.
