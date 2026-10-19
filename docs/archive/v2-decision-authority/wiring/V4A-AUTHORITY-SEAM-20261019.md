# V2 -> V4a actual authority seam (in-progress source, root integrates)

Read V4a CONTRACT.md and CLAUDE-REQUEST.md completely. V2's current decision
callbacks are evidence-only: NO durable operation reservation, one-use execution
grant, adapter invocation, credential identity attestation or approval consumption
exists in V2. A resolved/delegated decision is never an operation token.

Actual APIs V4a can consume after root accepts the exact V2 candidate:

- `MonoDecision.identity`: original goal/request/user message/project/owner/engine,
  request/requester sessions and bindings, retained request/dispatch generation,
  optional task/dispatch IDs. This is read-only evidence, not a current operation
  context. Live turn generation is separately read from App's turnGen map.
- App-owned `DecisionRuntimeHost`: authenticated roster/session/run accessors,
  live generation and habit ownership, original retained-history hydration,
  exact durable queue delivery, ledger-derived user notices, normal Manager
  re-raise. It contains no executeOperation or reserveOperation callback.
- `DecisionUiActions.command` / `.reraise`: native direct event + managerId +
  retry requestId + typed bounded decision action. Host authenticates the event,
  roster and original work independently. Only this direct boundary creates a
  user actor; chat/CLI/automation/habit text cannot. isTrusted does not establish
  OS-level human presence or same-user isolation.
- `MonoManagerGoals.handleDecision` / `.recoverDecisions`: same serialized
  version-1 goal ledger with durable signature/result/outbox receipts. These
  decision receipts are not operation reservations and must not be repurposed
  by pretending an operation was a decision action. Retry IDs preserve exact
  actor/action input. Existing capacity, failure and read-back guards remain.

Minimal proposed V4a extension (requires root's explicit shared/native ownership
and existing Claude review before implementation): an operation-specific typed
receipt in this same ledger's existing serialized writer, reserving exact trusted
adapter revision/arguments/resource scope plus verified execution identity and
one-use approval BEFORE invocation. Revalidation follows every await; uncertain
execution remains reserved and cannot replay. Existing native approval/CLI gates
remain the execution boundary; V4a supplies actual verified credential identity,
tool pins and pre-execution policy, not agent-labelled operation classes.
This proposal is not an implemented callback or accepted storage contract.

V2 will not add an unused generic broker API or broaden decision permissions.
V4a can continue its isolated model/UI work now. Root coordinates the concrete
operation receipt delta/native identity gate with Claude and the later explicit
App/decision/session/CLI path handoff; do not copy unmerged source. Local-first,
BYOK later, no hosted backend and same-user bypass limits remain unchanged.
