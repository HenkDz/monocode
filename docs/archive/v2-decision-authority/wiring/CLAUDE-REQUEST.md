# Existing Claude — early authority/persistence review request

Please review CONTRACT.md now, especially the two P2 strategies. Root routes this request to the existing Claude; no fanout or Codex storage audit.

Concrete questions: Does whole-decision-domain quarantine in the existing ledger, retaining exact parsed raw decision fields and decision outboxes while preserving receipt tombstones and unrelated goal work, satisfy the safe P2 quarantine requirement? Is a trusted live roster accessor with active originating Manager/project membership, processed before any goal/run snapshot, the correct no-goal autonomy boundary?

Implementation starts independently at accepted foundation `4b32e8b1`. No tests/install/browser/server/tsc/build/native before capacity grant. Final exact-pin review will include source, connected tests and honest evidence limits; this request does not claim source clearance or working production wiring.

## Mandatory review additions accepted / scope expanded

All four additions in CLAUDE-CONTRACT-REVIEW.md are accepted. New decision domains open atomically with immutable quarantine evidence; only direct UI gestures create user actors; prompt policy derives from bossMayDecide; busy recipients use the existing queue with no steering. Include monoDecisionRuntime/Delivery, session model, sessionStore metadata sanitation and messageQueue in final authority/persistence review.

Generation mapping review question: the runtime retains all foundation request text, original user block, account/home/binding, actual roster chain, run state, task and exact active dispatch guards. It additionally captures the authenticated CLI sender's current provider-turn generation and binding before entering the serialized ledger, revalidating them on every live snapshot so Stop or a replaced turn cannot publish queued intake. For the decision's restart-stable original generation, the adapter currently uses the actual retained dispatch.startedAt for a worker, or retained goal.createdAt for a Manager; these fields are canonical persisted values, never message text. They do NOT replace dispatch ID/state, run status/recovery, cancellation or binding checks. Please assess this explicit mapping at the final exact source, especially same-request restart, stopped/replaced engine, duplicate recovery and post-await consumption. Actual App turn-generation binding and consumer proof remain pending V1 handoff; timestamps alone are not claimed to prove Stop safety.
