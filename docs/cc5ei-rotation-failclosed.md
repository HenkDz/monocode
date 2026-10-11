# CC5EI: unreadable rotation continuity blocks submission

CC5EHR reproduced ordinary Retry and edited resend reaching OpenCode without
the saved user restrictions when reading `monocode:mono-rotations` failed.
CC5EI distinguishes an unreadable store from a readable store with no carry.
It also fixes the obsolete context limits retained by boot catalog normalization.

## Behavior and design

`loadMonoRotation` returns `undefined` for an absent carry and `null` for an
unreadable store. Throwing reads, malformed JSON and invalid store containers
cannot become an empty store. The planner returns "Can't read saved context;
retry". Ordinary and edited submissions refuse the turn before storage/folder
preparation, edited preparation, provider rewind or dispatch. Async preparation,
provider-aware prompt assembly and both busy follow-up paths recheck reads
before their provider operation. Edit and keyboard recall use the same rule.

The carry stays unchanged until reads recover. Then ordinary Retry delivers
the original input, saved restrictions and retained assignment. Only the exact
provider acceptance receipt clears it. Successful acceptance, in-memory replay
suppression and durable-clearing backoff remain intact: 250 ms initial delay,
doubling to a 30-second cap, cancelled by newer carries or deletion.

CC4 shows the idle refusal as blocked storage with the retry reason. Rejecting
a follow-up while a provider turn is running appends the reason without
ending that turn or its tools; CC4 keeps its working status and shows the
reason as a warning. A queued follow-up that fails after preparation retains
its message and pauses its queue through the existing recovery callback.
The shared reason lives in the dependency-free context-usage module so the
event reducer and live selector do not acquire a rotation/Mono import cycle.

Boot normalization applies the existing `dropContextWindow` helper only when
the selected model or settings change. Occupancy, transcript, provider/account
identity and metrics survive. An unchanged profile keeps its existing limits;
unreported context remains unknown.

No storage reset, automatic carry discard, replacement transaction, new
dependency, model default or transport retry was added. A thrown-read exception
from the load API was rejected because callers render this state as well as
submit turns. A separate storage state on Session was unnecessary: the existing
error notice carries the reason and resolves through the existing retry path.

## Regression coverage

The committed actual-adapter tests port both CC5EHR OpenCode sequences:
fresh startup fails before binding followed by ordinary Retry, and a stored
prompt loses its response followed by Stop and edited resend. Throwing reads,
invalid JSON and serialized null each require zero preparation, rewind or
dispatch. Read recovery sends the preserved restriction, assignment and original
input through the real adapter, then clears with its receipt. Further cases
cover outages during async preparation and busy follow-up dispatch.

Planner tests distinguish absence from read failure and preserve carry bytes
through failed saves/discard. Actual pane pointer and ArrowUp checks prove Edit
stays disabled until reads resume. Reducer/live-selector tests preserve active
turns and show storage status. Actual boot callback tests cover model-only,
settings-only, combined and role-effort normalization, unchanged profiles and
unknown context.

## Validation

Windows, Node 26.5.0, Vitest 3.2.7;
`NODE_OPTIONS=--no-experimental-webstorage` on every web check.

| Check | Result | Wall time |
| --- | --- | ---: |
| Focused rotation, adapter, boot, pane and repaired fixture group | 15 files; 266 passed, 0 failed/skipped | 8.207 s |
| Full Vitest, four workers, 20 s test/hook deadlines | 612 files passed, 2 skipped, 0 failed; 7,448 tests passed, 13 skipped, 0 failed/todo; 0 unhandled errors | 130.246 s |
| `npx tsc --noEmit` | Exit 0, no diagnostics | 24.436 s |
| `npm run build` | Exit 0 | 40.874 s |
| Historical reviewer boot-normalization reproduction | 1 passed, 10 filter-skipped, 0 failed | 14.31 s runner |
| Source SHA256 before/after complete gates | All 1,443 files unchanged | Recorded in evidence |

The 13 existing skips are three Antigravity real and ten soak cases. No native
source changed, so focused cargo tests were not required. Counts overlap across
focused, historical and full runs and are not summed as unique coverage.

The first full run failed eight tests in three legacy fixtures: two had no
readable synthetic localStorage, and an extracted App callback lacked the new
loader/reason dependencies. Their original assertions remain intact with
explicit healthy stores and actual callback dependencies. The next full run
failed an untouched pasted-image fixture's fixed 30 ms pause; it passed 13/13
unchanged in isolation, then its pause was replaced by a bounded wait for the
expected error callback. A two-worker run then timed out the first untouched
CRLF editor Git test at five seconds, cascading into three editor failures.
That file passed 4/4 unchanged in isolation. Complete verification retains all
assertions and supplies 20-second CLI deadlines for Windows Git scheduling;
the CRLF fixture and attachment/editor implementation remain unchanged.

All four full attempts, isolated results and final command receipts remain in
the evidence folder. Final files use the `-complete` suffix. The original boot
regressions also have a deliberate red result (4 failed / 4 passed) and a green
two-file result (24 passed). Local `npm ci --no-audit --no-fund` exited 0 in
44.494 s without manifest/lock changes; no dependency update was made.

## Evidence and limits

Input: `C:/Users/nooro/AppData/Local/Temp/monocode-cc/cc5ehr/REPORT.md` and its
`evidence/edits/adapter-opencode.test.ts`, `evidence/recovery/recovery.test.ts`
and historical boot fixtures. Current receipts and raw logs are under
`C:/Users/nooro/AppData/Local/Temp/monocode-cc/cc5ei/evidence/`; the round report
records final revisions, exact validation counts and timing.

All storage and provider faults use synthetic memory stores and mocked child
HTTP boundaries. No real profile/database mutation, live model turn, native
preview, native change, merge, push or shipment occurred. No actual disk,
native lifecycle or remote-network acceptance is claimed. Restarting before
an accepted carry can be durably cleared retains the existing replay limit;
lost provider acknowledgments and deliberate duplicate authority text remain.
