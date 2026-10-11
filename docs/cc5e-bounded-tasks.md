# CC5E: bounded tasks and earlier context refresh

CC5E extends the existing provider-thread rotation path to retained worker
continuations as well as Mono chats. App session, task, dispatch, checkout,
account, permissions, selected model/settings and user-locked profiles stay
intact. The transcript stays in the chat and remains available through
`app sessions.read`. New tasks still use the existing fresh-session path.

## Policy and safe boundaries

`taskContextBudget.ts` uses the latest reported context level. It refreshes
before the projected next input reaches 75% of an advertised effective
compaction threshold, or 60% of a known window when that threshold is absent.
Unknown or invalid limits never become invented model defaults. Input growth
uses UTF-8 byte counts for the next text and the latest turn's text/tool output,
reserving room for similar work. It never uses cumulative billed token totals.
The estimate is conservative text accounting, not tokenizer telemetry; hidden
provider context, attachments and unusually long tool work can still compact.

The policy runs between turns. Busy turns, streaming/tool activity, background
work, pending provider switches, workspace/storage preparation, open questions
and undecided approvals hold refresh. An unchanged profile retains its usage;
model, harness, settings and project changes invalidate the old limits. The
optional provider event field is forwarded without inferring its value. No
adapter currently supplies a verified effective threshold in this checkout,
so advertised windows use the 60% fallback.

The context meter keeps the actual reading, labels a scheduled refresh with
“Will refresh context before next turn”, and states unknown windows and
thresholds plainly. Remote sessions do not schedule this local policy.

CC5EF also shows those labels beside the primary Mono composer used by
Grand Orchestrator, Managers and members. Both composer surfaces plan with
the current draft. An oversized carry or incomplete archive displays a
specific deferral reason and a manual-compaction or trimming/loading path;
it does not promise a refresh that the next input cannot fit.

## Continuity and failure recovery

The deterministic existing brief keeps recent exchanges and excerpts from
earlier ones. Retained internal worker turns are labeled untrusted task
evidence. Original user requests are carried verbatim across rotations;
the retained worker brief also carries its original assignment, continuation,
file scopes, goal/dispatch/checkout IDs and artifact references. Prior evidence
does not supersede the current request or current dispatch authority.

Rotation defers if the complete original constraints are unavailable in a
paged archive, if constraints/scope/references exceed 8,000 characters, or if
the brief plus pending input cannot fit the 14,000-character allowance left
by CC1's 12,000-character first-thread context and 26,000-character rotation
budget. This avoids truncating user constraints. Complete constraint carries
allow subsequent rotations while older transcript pages remain archived.

The brief is saved before provider detachment. A failed save leaves the old
thread intact. Failed detachment or fresh-thread startup retains the brief
and original attempted input for retry; only provider acceptance clears the
pending carry. Detachment invalidates both agent and org delivery receipts,
and CC1F's provider-aware preparation hands full chart, soul and memory to the
actual replacement thread. No destructive chat reset is used. Codex private
store migration remains exclusive to Mono chats, matching their existing
storage selection. Generation checks prevent a cancelled submission from
detaching a newer turn after migration.

CC5EF preserves every unaccepted input across repeated startup failures,
merges subsequent visible user constraints, and saves the updated carry
before every retry. Retry carries obey both size allowances. If a pending
carry cannot fit, submission reports the reason before another detach or
startup can omit it. Acceptance clears the pending inputs only after the
provider receives them.

CC5EG counts the next input before the first refresh using the same protected
text accounting as retries, and reserves room for its retry wrapper within the
14,000-character allowance. Identical request text is counted once while request
IDs remain retained. An oversized initial input keeps the current provider;
shortening the draft or successfully compacting that provider allows progress.
A rejected pending retry returns before committing its user block, so it stays
correctable and cannot poison later short retries.

CC5EH disables edited resend while a rotation carry is pending, before storage
preparation or provider rewind. The visible Edit action and keyboard recall use
the same rule: "Retry the original first. Editing is available after it's accepted."
Pending text cannot absorb an edited replacement. After acceptance, supported
task chats retain their existing edit and rewind behavior; primary Mono/org
chats retain their existing no-Edit policy. CC5EG's pre-rewind replacement save
has been removed.

CC5EI also refuses ordinary Retry and edited resend when the saved continuity
store cannot be read. A readable absent carry and an unreadable store are
distinct; read failure leaves the carry untouched and reports "Can't read saved
context; retry" through CC4's storage state. Edit and keyboard recall stay
disabled. Async preparation and busy follow-up paths recheck reads before
rewind or dispatch. A rejected follow-up preserves an already running turn and
shows the storage reason as a warning. Restoring reads permits ordinary Retry
with the saved restrictions, original input and retained assignment.

Provider acceptance remains successful if clearing its saved carry fails. The
app retries the exact accepted carry after 250 ms, doubling delays up to 30 s,
and shows a small storage warning in the chat and CC4 live state. The working
or completed status stays accurate. Until clearing succeeds, an in-memory
settled view prevents replay in the running app. A newer carry, explicit
discard or session deletion cancels the old retry; unreadable storage does not
overwrite other carries. This settled view cannot survive app exit before a
successful durable write, so restarting during an ongoing storage failure can
still encounter the old saved carry.

Compaction cannot shrink saved pending inputs. Oversized legacy carries offer
"Discard pending input" on retained tasks, primary Mono and org chats. The
confirmation previews every unaccepted input being discarded, including visible
continuations after the saved boundary. Nothing changes until confirmation and
a successful durable save. Stale previews and unreadable storage fail closed.
Accepted constraints, the original brief and assignment, references and visible
history stay intact; discarded failed block IDs prevent later reabsorption.
If the original boundary is unloaded, load the earlier conversation before
discarding. The new initial bounds still prevent creating these oversized
carries through the reviewed startup sequence.

Delivery is not literally exactly once. Each structural carry block appears
once, but the same restriction can appear in both recent conversation and
protected user requests, and a current request can appear in the retry wrapper
and current prompt. Lost provider acknowledgments can also cause retries of
already stored input. These continuity duplicates remain deliberate; this
round prevents abandoned replacement text from entering pending carries and
does not claim transport-level exactly-once acceptance.

Context and configuration events retain their submitted harness/model/settings
identity until the event queue reaches the reducer. A changed selection rejects
old limits and configuration while keeping occupancy, transcript, billing and
compaction observations. Canonical provider configuration advances that turn's
identity so its subsequent limit-only updates still work.

CC5EI applies the same limit invalidation to boot catalog normalization when
the selected model or settings change. The old window and compaction threshold
are dropped while occupancy and other observations remain; unchanged profiles
retain their limits.

## Task sizing

The offline `app rules delegation` topic recommends one coherent change,
explicit file ownership and about 5–15 minutes per task. Substantial discovery,
implementation and verification become stages. Workers checkpoint at stage
boundaries and put full evidence in artifacts with short conclusions. Reviews
use bounded handoffs, exact dispatch references and artifact links. Safety
transactions are kept intact; the app does not stop long indivisible tools to
meet a timing target. No always-present prompt or authority core was expanded.
The native executable embeds this topic, so shipping it requires a native
rebuild.

## Rollout measurement

After an authorized rollout, collect stable before/after database copies and
matching copied Mono and worker rollout directories. Run the existing analyzer
for each cohort:

```powershell
rtk proxy python scripts/measure-mono-rollouts.py <mono-rollouts> <copied-monocode.db> --extra-sessions <worker-rollouts>
```

For each role, take the `turns` denominator from the context table and the
deduplicated `compactions` count from the compaction table:
`compactions per 100 turns = 100 * compactions / turns`. Keep affected turns
separate from event counts. Compare at least 30 equivalent worker turns with
the same model, account, effort and project state. Include failed, cancelled
and unknown outcomes; separate cold starts, resource waits and indivisible
long tools. Also compare worker duration p95 and first-output p95. The targets
are at least 50% fewer compactions and worker-turn p95 below 15 minutes; this
round does not claim those live results from synthetic tests.

## Original CC5E validation

Windows; web checks used `NODE_OPTIONS=--no-experimental-webstorage`.

| Check | Result | Wall time |
| --- | --- | ---: |
| Full `npx vitest run --maxWorkers 4` | 560 files passed, 2 skipped, 0 failed; 6,254 tests passed, 13 skipped, 0 failed/todo | 360.804 s (358.24 s runner) |
| `npx tsc --noEmit` | Exit 0, no diagnostics | 37.559 s |
| `npm run build` | Exit 0; existing CSS/chunk warnings | 80.814 s (39.95 s Vite) |
| Native `cargo test --manifest-path src-tauri/Cargo.toml --lib control_cli::tests -- --test-threads=1` | 23 passed, 0 failed/ignored/measured, 652 filtered | 80.138 s (0.38 s runner) |
| Analyzer `--self-test` | Exit 0, synthetic checks passed | 0.511 s |
| Failed-only serial rerun of two untouched editor files | 13 passed, 0 failed/skipped | 12.108 s (9.77 s runner) |

The first default-concurrency full run failed in two untouched editor files:
558 files passed, 2 skipped, 2 failed; 6,241 tests passed, 13 skipped, 13
failed, in 60.077 s wall (56.83 s runner). They passed unchanged in isolation,
then the complete suite passed with four workers. Both runs are retained.
The 13 skipped tests are existing Antigravity real/soak tests. CC1's prompt
budget tests passed, including the unchanged 700-character authority core
and 1,000-character steady-turn limits.

Focused tests cover exact boundaries, unknown/stale limits, live tools and
decisions, preserved constraints/transcripts/scopes/accounts/locked profiles,
bounded artifact provenance, failed thread startup and retry of its original
request, and real registry delivery receipts on rotated Manager/member
threads. Dependency bootstrap used local `npm ci`, with no package/lock edits
or force/global installation; existing nine audit advisories were retained.

## Evidence and limits

Baseline: `C:/Users/nooro/AppData/Local/Temp/monocode-cc/FINDINGS.md`.
Design: `docs/cc2-orchestration-design.md`, section 5.
Validation receipts and logs: `target/cc5e-verification/`.
Final inventory, commit and validation totals:
`C:/Users/nooro/AppData/Local/Temp/monocode-cc/cc5e/REPORT.md`.

The original CC5E run made no live model turn, desktop preview, profile/database
mutation, native storage, skills or routing/wake batching change, push or merge.
Native runtime/provider acceptance and latency improvement remain coordinator
rollout checks. Oversized or incompletely loaded constraints deliberately
defer automatic refresh; task segmentation remains the safeguard for those
cases and for live turns without an idle boundary.

## CC5EF repair validation

The review's four findings and their committed reproductions are documented
in `docs/cc5ef-rotation-fixes.md`. Current repair evidence is under
`C:/Users/nooro/AppData/Local/Temp/monocode-cc/cc5ef/`; `REPORT.md` records the
integrated branch revisions, exact checks and remaining rollout limits.

CC5EF at source revision `83a667d` passed 573 Vitest files with 2 skipped:
6,542 tests passed, 13 skipped, zero failed. TypeScript and production build
passed; focused native control CLI tests passed 23/23. The first full run
had one unchanged CRLF editor timeout under concurrent compilation; that file
passed unchanged alone and the complete rerun passed without concurrent
compilation. The repair merged CC5E only into its own branch.

## CC5EG recovery repair validation

Implementation: `1bac845d915d41d60c76409ecaf9781a76aa08fb`.
The focused five-file recovery suite passes 145 tests, zero failed or skipped.
It includes the actual OpenCode adapter's stored-prompt/lost-response fault,
Stop cleanup and successful rewind, plus real App compaction and the visible
context meter. Full Vitest passes 590 files with 2 skipped: 7,063 tests passed,
13 skipped, zero failed. TypeScript and production build pass; no native source
changed. Full validation details and the final documentation revision are
recorded in `docs/cc5eg-rotation-recovery.md` and
`C:/Users/nooro/AppData/Local/Temp/monocode-cc/cc5eg/REPORT.md`.
Logs and machine-readable receipts are in that round's `validation/` directory.

## CC5EH simplified recovery validation

Implementation: `f426f92d304988ab9904149c90f062d0eaeb1d6e`.
The full suite passes 606 files with 2 skipped: 7,266 tests passed, 13 skipped,
zero failed. TypeScript and production build pass. The focused eight-file
suite passes 242 tests; independent actual-adapter fixtures pass 20 tests and
writer/App checks pass six checks. No native source changed.

Design decisions, failed-attempt disclosure, exact timings and remaining
storage/exactly-once limits are recorded in `docs/cc5eh-rotation-simplify.md`
and `C:/Users/nooro/AppData/Local/Temp/monocode-cc/cc5eh/REPORT.md`.

## CC5EI unreadable continuity repair

Full Vitest passes 612 files with 2 skipped: 7,448 tests passed, 13 skipped,
zero failed or unhandled errors. TypeScript and production build pass. The
focused 15-file suite passes 266 tests; the actual OpenCode fixture contributes
15 cases including read recovery, async preparation, busy follow-ups and
provider switching. No native source changed. Windows verification uses four
workers and 20-second test/hook deadlines after diagnosing shared-load timing
failures; the pasted-image fixture now waits for its actual error callback.

Design, regression scenarios, validation receipts and remaining runtime limits
are recorded in `docs/cc5ei-rotation-failclosed.md` and
`C:/Users/nooro/AppData/Local/Temp/monocode-cc/cc5ei/REPORT.md`.

## CC5EJ continuity and completion queue recovery

Branch: `HenkDz/cc5ej-rotation-continuity`.
Base: `f0e368f2b85361bdae7af005ace5c6d2953b7a63`.
Final implementation: `9e764721b33f0d6f50e69aeaa0de2e8a39da1191`.
The final documentation commit and branch tip are recorded in the external report.

Saved carries now validate their entry shapes and pending-field consistency.
Incomplete or unknown authority stays unreadable and unchanged. Settled carries
and supported legacy reasons remain readable. Planning captures the saved receipt;
the existing writer compares it before persistence, and submission checks it after
awaited preparation. Changed continuity refuses delivery until Retry replans from
the latest carry. Acceptance still clears only its matching receipt, including
the effective settled projection while durable clearing retries.

Queue refusal, exception handling and Resume now cover both queued user messages
and pending completion events. The orchestration Resume caller uses that same head.

Full Vitest: 622 files passed, 2 skipped; 7,893 tests passed, 13 skipped, zero
failed/todo. TypeScript and production build pass. The six changed-area files
pass 119 tests. Earlier reproductions pass 129 external tests and 625 focused
source tests, plus all retained assertion runners. CC5EIR's nine-case contract
changes from 3 passed / 6 failed on the base to 9 passed / 0 failed on this
implementation. Counts overlap and are not summed as unique coverage.

One malformed entry conservatively makes the rotation store unreadable for local
sends; no reset or automatic authority reconstruction is attempted. Native disk,
multi-window transaction timing, renderer-exit replay and live provider acceptance
remain unproven. No native source changed, and no preview or model turn ran.
Design, fixture adaptations, failed setup attempts, exact checks and evidence:
`docs/cc5ej-rotation-continuity.md` and
`C:/Users/nooro/AppData/Local/Temp/monocode-cc/cc5ej/REPORT.md`.
