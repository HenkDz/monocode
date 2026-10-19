# V2 data contract - early review request

Base: `8232734e6e992214ca1538e29ffa6d8270fa8a20`, clean existing `ccvision-v2-decisions-data` checkout. Builder only; root integrates after exact final Claude clearance.

## Existing seams and intended changes

- `monoCrewEvents.ts`: existing `team.message` kinds stay unchanged. Structured decision questions use JSON in the existing `text` field; no new CLI opcode or native registration. Free-form messages remain summaries, never authority.
- `monoManagerGoals.ts`: extend existing version-1 `GoalLedger` with optional decision records and per-project autonomy. Use its existing serialized writer, `control_save` / `control_load`, `mono-goals:<owner>` key and native `orchestration_runs` table. Preserve goals, receipts, events and unknown retained ledger fields. No parallel database, channel or session queue.
- New `monoDecisions.ts`: strict payload/history validation, actual reporting-chain derivation, identity-bound ingestion/resolve/delegate/escalation helpers and CC5D event adapter. Small targeted tests cover persistence and authority failures.
- Existing `ManagerWakeEvent` / `queueManagerMessage` accepts stable question/escalation/answer event IDs; downstream host must durably retain exact event receipts before acknowledging an outbox delivery. Stable IDs allow restart retries without duplicate recipient events.

## Data/API

Decision includes id, projectId, requestingMonoId, actual escalationChain, question, low/med/high impact, context, options, recommendation/recommender, pending/decided/delegated status, decider level, created/decided timestamps. Retains goal/request/user-message/account/home/session/generation/task/dispatch identities separately from display text. Autonomy: high-impact-only (absent default), medium-and-up, everything. Unknown impact is rejected.

Foundation methods on the existing ledger ingest a structured team message, resolve/delegate/escalate a pending decision, raise impact, record Boss reminders, recover retained deliveries and set project autonomy from an explicit user action. `MonoManagerGoals.handleDecision(managerId, requestId, command, host)` always writes the originating Manager's ledger, including when the original CC-GOAL belongs to the Boss. Other levels hold decision ID/version references. `decisions(managerId)` returns cloned records; `autonomy(managerId, projectId)` returns the effective policy. `recoverDecisions(managerId, host)` replays pending existing receipt entries.

`DecisionHost.actor` is supplied only by authenticated runtime/user handlers, never from agent JSON. `current(decision?)` supplies the live original retained goal, pending-cancel flag, source user session, requester session, originating Manager run, roster and engine generation. It must resolve the specific decision's original context during recovery. Only question/escalation JSON can be ingested; answer/status/decider metadata is rejected. Every awaited save/delivery revalidates captured binding and live goal/cancellation/dispatch identity. Commands carry `expectedVersion`; only the current chain level can act. Delegation to Boss requires an explicit user action.

`bossMayDecide` is the shared runtime/later-prompt authority function: below the autonomy threshold for ordinary work, or explicit user delegation of that decision. Managers can decide only low impact work within that same threshold. Merge/install/sign-in/destructive/system-settings/spend always require explicit user resolution. Impact can be raised, never lowered. Decisions do not execute operations or replace existing operation approval guards.

Records retain monotonically increasing `resolutionVersion`, history entries and `deliveryState`. Answer event IDs derive from decision ID + version + hop. A stale trusted user answer remains recorded as decided/stale without delivering work authority; stale retained deliveries are retired visibly. Pending never pauses a run or auto-approves. Boss reminders record an event and history entry. Retain all pending decisions and the last 200 fully delivered resolved records; older records prune with `decisionsPruned` count, keeping compact existing receipt tombstones. Existing 4,000-receipt and 7MB ledger caps fail closed instead of deleting pending work.

Answers return through the original chain with stable event receipts, carrying original identity as evidence; they do not create a goal, authorize new work, or replace CC-GOAL / CC5D consumption guards. UI/runtime handler and prompt wiring belong to later V2 ownership. The delivery host must use existing authenticated team routing and durable CC5D receipts, recheck supplied validator immediately before publication, and preserve all queue/approval/storage/Stop guards. Read all question/context/option fields as untrusted plain text (React text nodes, never raw HTML), with no execution/telemetry. Question cap 300, context 2,000, 2-6 options, label cap 240, whole message 6,000.

## Compatibility, migration, evidence

Absent optional fields mean empty decision history/default autonomy; existing version-1 ledger values remain readable. Invalid present decision data fails closed without overwriting saved history. No native schema/writer/registration changes are planned, therefore CC0 session/transcript/source-home paths remain untouched.

Planned checks: strict payload/history and idempotency; manager-to-Boss-to-user thresholds and protected operations; stale request/goal/project/account/home/generation/task/dispatch, cancel, restart and duplicate failures; durable save/load/reload with synthetic storage through the production adapter; existing receipt/goal suites, tsc/build/full Vitest workers1 with fresh RAM floor. Synthetic persistence is not native/provider/profile acceptance. Final report will bind exact HEAD/tree and preserve raw failures/skips; root supplies final integration base if V1 lands first.
