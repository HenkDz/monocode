# CC5EK: authority at provider dispatch

CC5EJ-R found a newer carry reaching OpenCode after App's final async check,
unknown nested request authority being omitted, and direct follow-up refusal
ending the original active turn. This round repairs those source boundaries.
Base: `56334de5e2480c652fcfc49943b28cba93c3b029`. Exact candidate and validation
pins are recorded in the external report; builder readiness does not grant SHIP.

The coordinator authorized merging exact validated nour
`c23762bbfd819adb68c79c7b7fbfd5939e8d65c8` into this branch. The merge at
`c65551901d936aa29ff1dffaa208db45be669bdd` retains incoming binding provenance,
private configuration, account, queue, rotation and migration guards. Its only
conflict combined `followUp` and `bindingProfile` event fields. The final tested
input is `ba792d519c603b435e8bd81687dbfc60593290d4`, tree
`be44ba3bb2402696d5e30f46cac8919d2e16df7c`, after one approved fixture correction.
All 1,712 non-documentation file hashes stay identical through every final gate
and the final documentation update. The final documentation head is in REPORT.

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
as a substitute for their existing refusal. CC5EK changes no host/native
configuration; the authorized merge retains the coordinator's CC6-J native/private
configuration changes byte-for-byte. No native gate was rerun in this web slot.

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

- Current connected provider/App/registry suites: 19 files, 693 passed, zero
  failed/skipped. All eleven prompt adapters, seven supported steer adapters,
  four unsupported refusals, Stop during preparation, v2 config, Cursor fallback
  and Hermes background handoff are exercised with synthetic transports.
- CC5EJ-R lifecycle: raw base 32 passed / 5 failed; corrected 37 passed / zero
  failed. The original nine and nine combined migration/binding callbacks pass.
- Historical families: 129 external tests, 639 focused source tests, and three
  A/B/C runners plus 6/5/3/10 writer/entrypoint/migration/preflight checks pass.
  All previous 627 source cases remain; 12 incoming provenance cases are added.
  Counts overlap and must not be summed as unique coverage.
- Full one-worker Vitest: 625 files passed, 2 skipped; 8,221 tests passed,
  13 skipped, zero failed/todo, 326.850 seconds wall. TypeScript passes in
  16.369 seconds; production build passes in 30.770 seconds. The runner verifies
  exact clean head and before/after hashes for each sequential gate. Build retains
  two CSS `::highlight` optimizer warnings, mixed mono imports and large chunks.

Evidence root: `C:/Users/nooro/AppData/Local/Temp/monocode-cc/cc5ek/evidence/`.
Raw baseline outputs and receipt observations are retained in `baseline/` and
`baseline-final5-*`; current results/logs/receipts include `approved-lifecycle-*`,
`original-nine-*`, `combined-binding-*`, and earlier connected runs. Final inputs
use `final-lifecycle-*`, `final-nine-*`, `final-binding-*`, `final-real-case-*`,
`final-connected-pin-*`, `historical/final-*` and `validation/final-attempt2/`.
`executed-case-inventory.json`, `caller-inventory.json`, `frozen-source.json` and
`fixture-adaptations.diff` provide actual executions, callbacks and hashes.
`final-source-associations.json` binds final documentation to validated inputs;
`merge-receipt.json` records the incoming source preservation.

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

The first merged full runner failed at external output-directory setup before
starting any gate; its traceback and controller receipt remain. Fixing only
`mkdir(parents=True)` allowed the full run to collect all tests. That run finished
8,220 passed / 1 failed / 13 skipped at c655519 because a retained direct App
fixture lacked the new `turnGen/gen` bindings. Binding-only setup then failed its
old exact error-object expectation: 25 passed / 1 failed. Both red runs remain red.

The coordinator explicitly selected fixture metadata handling. The committed
fixture adds actual generation bindings and `followUp: true` to the exact expected
`session.error` object with the exact `MONO_ROTATION_READ_ERROR` message. Every
original active-turn, queue identity/status, canonical running-tool and zero-steer
assertion stays unchanged. No loose matcher or production compatibility branch
was added. This approved diff is `source-fixture-adaptation.diff`; the actual
corrected case passes 26/26, and all required gates rerun on the new frozen input.
The separate external lifecycle retains 101 original assertion ASTs plus the
approved empty-dispatch observation, for 102 current assertions.

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
