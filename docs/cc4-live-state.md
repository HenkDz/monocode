# CC4: live agent state and turn metrics

Branch: `HenkDz/cc4-live-state`. Base: `de8edc3b389c3362134cc5a521458b241496b4c2`.

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
Counters without provider evidence remain absent. The token line shows separate
input, cached and output counters. Codex input includes cached input; Claude,
Pi and OpenCode report uncached input separately. These retain the existing
provider semantics, so consumers must account for that difference when computing
a total or comparing providers. The UI does not add potentially overlapping
counters together.

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
elapsed label describes its displayed dispatch. Missing counters remain absent;
partial totals are marked as recorded metrics. Selectors deduplicate user-turn
identities, include retry dispatches and keep unrelated session turns out of
tasks with an exact turn reference.

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

Final Windows / Node 26.5.0 validation uses
`NODE_OPTIONS=--no-experimental-webstorage` throughout:

| Check | Result |
| --- | --- |
| Full Vitest suite (`npx vitest run --maxWorkers=8`) | 552 files; 6,038 passed, 13 skipped, 0 failed; 6,051 total tests |
| `npx tsc --noEmit` | Passed |
| `npm run build` | Passed |
| `git diff --check` | Passed |

The worker cap limits concurrent test processes without filtering or skipping
tests. The first development run recorded integration assertion failures and
editor fixture failures under higher concurrency. The unchanged editor fixture
passed all four cases independently and in the final full suite. The production
build retains two existing CSS optimization warnings. Native files are
unchanged, so no native test was required. Fixtures use synthetic sessions and
provider events; no live model turns, preview, user profile writes, push or merge
were performed.

Evidence is under `C:/Users/nooro/AppData/Local/Temp/monocode-cc/cc4/evidence/`:
`vitest.json`, `vitest-first.json`, `typescript.log`, `build.log` and
`validation.json`. `../REPORT.md` contains the branch, final commit, changed
files, decisions, detailed results and follow-ups.
