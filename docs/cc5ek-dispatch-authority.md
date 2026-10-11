# CC5EK: authority at provider dispatch

CC5EJ-R found a newer carry reaching OpenCode after App's final async check,
unknown nested request authority being omitted, and direct follow-up refusal
ending the original active turn. This round repairs those source boundaries.
Base: `56334de5e2480c652fcfc49943b28cba93c3b029`. Exact candidate and validation
pins are recorded in the external report; builder readiness does not grant SHIP.

## Committed dispatch boundary

`SendTurnInput` and `SteerTurnInput` carry an optional synchronous
`validateDispatch` callback. App supplies it for ordinary/retry/repair sends,
queued follow-ups and direct follow-ups. It checks the captured turn generation
and complete rotation receipt. Registry queueing and CLI context wrapping retain
the same callback. Existing preparation, account, harness, queue and acceptance
checks remain in place, including CC8-X's awaited relocated binding save.

Each connected adapter calls this callback immediately before issuing its
prompt or steer transport. No await separates that assertion from issuing the
request in the renderer. JSON RPC and Pi RPC synchronously serialize and call
`writeChild`; Claude's `writeJson` does the same. OpenCode's client asserts after
v2 model/agent configuration, immediately before its HTTP prompt request. This
also covers v1. Its adapter adds current-live/cancellation checks there, so Stop
during awaited configuration cannot send a prompt. Genuine stream/process
failures still reject; only the stopped-turn refusal is suppressed for a muted
live connection.

The boundary commits authorization when the renderer issues the prompt/steer
to `writeChild` or `harnessHttp`. It is not the later provider acknowledgment.
A carry saved after issuance stays saved; acceptance only clears its matching
receipt. App's accepted projection still advances the closure's expected receipt
while durable clearing retries, so later repair sends compare the correct state.
No writer is discarded, deferred or locked out to force delivery.

## Connected caller inventory

| Provider | Prompt consumer | Steer consumer / later await |
| --- | --- | --- |
| Codex | `runTurn` → `turn/start` | `steerCodexTurn` → `turn/steer`, original expected turn id |
| Claude | `runTurn` → user JSONL | `steerClaudeTurn` → user JSONL |
| Pi, OMP | shared `piFamily.runTurn` → RPC prompt | shared `steerTurn` → RPC steer; OMP command prompt retains its id |
| OpenCode | `runTurn` → client `promptAsync` | `steerOpenCodeTurn`; v2 config await → client assertion → HTTP prompt |
| Cursor | `prompt` → ACP prompt | `steerCursorTurn`; both initial and awaited fallback notifications validate |
| Hermes | `prompt` → ACP prompt | `steerHermesTurn`; every background continuation also validates after handoff reads and checks Stop |
| Devin | `sendDevinTurn` → `prompt` → ACP prompt | Explicit unsupported refusal retained |
| fx, Grok, Antigravity | adapter `prompt` → ACP prompt | Explicit unsupported refusals retained |

The App producers are its `sendTurn` closure, queued `deliverQueuedFollowUp`
steer callback, and direct busy async follow-up. Receipt validation lives in
`monoRotation`; registry `sendHarnessTurn`/`steerHarnessTurn` forward the contract.
Existing remote submission and native command boundaries remain explicit:
remote routing occurs before local rotation lookup and does not acquire a
renderer carry policy on the host. Unsupported paths do not dispatch a callback
as a substitute for their existing refusal. No host/native configuration changed.

## Unreadable authority and follow-up failures

Each `userRequests` entry accepts only the current `id` and `text` shape.
Unknown fields, including nested string/object `futureAuthority`, make the map
unreadable. Reads, saves and deletion preserve the original bytes. Supported
legacy/settled carries remain readable; no migration or automatic reset guesses
unknown restrictions.

Direct follow-up errors are marked `followUp` on the existing error event. The
reducer appends the error while preserving a busy original session, active tool,
streaming answer and turn-ready state. Genuine provider errors still settle the
turn. A changed generation cannot report a stale follow-up error into another
turn. Queued refusal keeps its existing retention/error/Resume behavior.

## Source validation and evidence

Windows, Node 26; every valid web probe uses
`NODE_OPTIONS=--no-experimental-webstorage` and one worker. No deadline, skip or
final expected-safe assertion was weakened.

- Current connected provider/App/registry suites: 19 files, 686 passed, zero
  failed/skipped. All eleven prompt adapters, seven supported steer adapters,
  four unsupported refusals, Stop during preparation, v2 config, Cursor fallback
  and Hermes background handoff are exercised with synthetic transports.
- CC5EJ-R lifecycle: raw base 32 passed / 5 failed; corrected 37 passed / zero
  failed. The original nine and nine combined migration/binding callbacks pass.
- Historical families: 129 external tests, 627 focused source tests, and three
  A/B/C runners plus 6/5/3/10 writer/entrypoint/migration/preflight checks pass.
  Counts overlap and must not be summed as unique coverage.
- Full one-worker Vitest, TypeScript and production build await the coordinator's
  explicit heavy slot. `VALIDATION-READY.md` binds the frozen source and gates.

Evidence root: `C:/Users/nooro/AppData/Local/Temp/monocode-cc/cc5ek/evidence/`.
Raw baseline outputs and receipt observations are retained in `baseline/` and
`baseline-final5-*`; current results/logs/receipts include `approved-lifecycle-*`,
`original-nine-*`, `combined-binding-*`, `final-connected-*` and `historical/`.
`executed-case-inventory.json`, `caller-inventory.json`, `frozen-source.json` and
`fixture-adaptations.diff` provide actual executions, callbacks and hashes.

Fixture adaptations bind current paths/configuration, the new actual App
dispatch callback and its generation dependencies. The user expressly allowed
the microtask case to catch only the exact changed-carry production refusal,
rethrow unrelated errors and observe zero HTTP dispatches. Its input and final
expected-safe assertion remain unchanged. No refused attempt is labeled an
actual dispatch; `refusal-adaptation.diff` records that narrow change.

Failed attempts remain recorded: incorrect first fixture microtask timing,
PowerShell's lost environment interpolation, a new-test import error, missing
new callback dependencies in unadapted external fixtures, and an overbroad
OpenCode muted-error catch that broke three genuine stream/process rejection
tests. Corrected probes pass those tests without changing their assertions.

## Remaining limits

One renderer's JS run-to-completion prevents another asynchronous writer between
the final synchronous assertion and request issuance. Cross-renderer localStorage
read/compare/write still has no transactional CAS. No native queue/socket timing,
live model acceptance, mounted-App incidence or frequency is claimed from mocks.
Renderer exit during failed durable clearing can replay accepted input; separate
transcript/carry writes and lost acknowledgments remain distinct durability limits.
A malformed map still blocks local sends until valid bytes are explicitly restored.
No new ledger, scheduler, dependency, authority truncation, account/ACL setup,
preview, live provider turn, profile mutation, push, merge or deployment occurred.
Independent corrected-head review and RG1 still follow.
