# Actual accepted-V1 wiring delta for existing Claude / public V4a boundary

Accepted root base `0e95c3751c94f3109fbbcb0c7f680d4c4a9f0a90` adopted by an
ordinary merge in this V2 child after clean independent `58f09900`. Root remains
sole integrator. Actual App/shell decision files remain V2-owned until handoff.

## Manager CC5D delivery under implementation

The originating ledger saves its exact source delivery first. App enqueues the
unchanged event in `orchestrator.queueManagerMessage`, preserving existing 250ms
question coalescing, wave/deadline/queue/approval policy and CC9 baseline limits.
It reads the run from `control_load`: exact event ID/body/signature and membership
in the retained digest receipt are required. It then reads the recipient session
through the existing serialized writer, verifying exact receipt ID/body/engine in
the saved queue, or an exact persisted internal transcript event via existing
`mono_session_event_delivered`. An in-memory engine event is insufficient.
Missing/not-yet-materialized/malformed/rejected/failed read-back throws and leaves
the source ledger outbox pending; ordinary same-request recovery retries it.
No intake starts, resumes or steers any provider turn. New decision actions first
recover pending source receipts, permitting an already-consumed exact digest to
acknowledge before the action resolves. Final tests must cover coalescence,
duplicate/restart/save-readback failure and Stop/generation changes at each await.

Manager digest consumers resolve decision event IDs back to current originating
ledger deliveries and exact source payloads, alongside every existing CC-GOAL
check. Other recipients use the existing session queue with strict monoDecision
references and a live retained-record lookup. A repeated guard checks after
setup awaits and immediately before provider publication; metadata never creates
a user block or user grant. Stale evidence is visible and cannot restart work.

## Other ports / V4a reuse

`DecisionRuntimeHost` remains the one App-owned adapter: actual ledger/roster/
sessions/runs, live turn generation, runtime habit ownership, awaited hydration,
queue, notification and ordinary Manager re-raise ports. Hydration reads original
saved user blocks; it does not fabricate or reclassify evidence as user requests.
Autonomy uses the live roster without requiring a goal or conversation.

`DecisionUiActions.command(event,managerId,requestId,command)` and
`reraise(event,managerId,requestId,oldDecisionId)` are the only user-facing mutation
ports. Real direct click/keyboard events inside data-decision-ui bind actor:user;
isTrusted is only an in-app script boundary, not OS-level user-presence proof.
Re-raise is a durable ordinary CC5D team event, retaining request-ID retry identity
and demanding a NEW decision ID. It never restores quarantined authority.

User escalation/reminder notifications are a ledger-derived in-app projection
keyed by the exact retained delivery event ID; sidebar/rail counts use
selectDecisionView. No notification store, fabricated user Mono, or second bus.

V4a may consume accepted public types/components after root integration. Decisions
remain evidence only. They cannot approve or execute merge/install/sign-in/delete/
system-settings/spend/message-people operations. V4a's local CLI/MCP/skills broker
retains its explicit operation approvals; BYOK is V4b later, with no hosted backend.
Do not import this unmerged source or edit V2-owned shared files before handoff.

This is the concrete in-progress production contract, not final source clearance.
Exact frozen wired tests/browser/tsc/build/full and existing Claude plus fresh
independent runtime review and separate release preparation are still required.
