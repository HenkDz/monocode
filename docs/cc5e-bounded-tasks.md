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

Context and configuration events retain their submitted harness/model/settings
identity until the event queue reaches the reducer. A changed selection rejects
old limits and configuration while keeping occupancy, transcript, billing and
compaction observations. Canonical provider configuration advances that turn's
identity so its subsequent limit-only updates still work.

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
