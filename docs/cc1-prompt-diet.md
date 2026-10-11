# CC1: smaller Mono application context

Original branch: `HenkDz/cc1-prompt-diet`, based on
`de8edc3b389c3362134cc5a521458b241496b4c2` (`nour` at round start).
CC1F integrates it with CC5-A on `HenkDz/cc1f-prompt-fixes`; final fixes and
validation are documented in `docs/cc1f-prompt-fixes.md`.

Mono turns carry each app block once. A fixed authority core accompanies
every Mono, member and habit turn, including steady turns and the current
input during compaction. It identifies the agent, role and reporting line,
prioritizes the user request, preserves user-only merges/destructive approvals,
frames repository/report/artifact text as evidence, and requires stable retry
IDs and the injected CLI path with a prior `app rules shell` read. Fixture
cores are 399/391/385 characters; configured identity fields are bounded so
the whole core always stays within 700 characters.

The org chart and detailed role rules are
sent again only when their exact SHA-256 content/version changes, the
provider conversation changes, or the harness/model/account changes, and
once per restored conversation after process start. Prompt version is 26.
Providers rebuild the prompt after resume/create confirms their conversation
and before serializing input. Unknown continuity forces full context; an
omitted plan cannot be recorded for a replacement provider. Receipt writes
happen on provider acceptance; rejected sends
and unavailable storage safely resend. Successful edit/rewind clears receipts
because the provider may have discarded the only copy of those instructions.
Deletion clears both identity and org receipts. The same handling covers
Mono chats, assigned member tasks and habit sessions.

## Duplication and rule delivery

The old `App.tsx` wrapped `appContext` through `monoTurn`, then appended that
same array in the `else` attached to the member-task condition. Every Mono
without a member task ran both paths. This duplicated the Manager's rules,
Grand Orch's rules, and rotation recaps. The copied prompt evidence contains
exact repeated blocks of 27,584 (`mgr_t0.txt`), 5,873 (`mgr_t4.txt`) and 18,352
(`go_t2.txt`) characters. There was no need to deduplicate arbitrary user text,
strip handoff contents, or change the rotation recap policy: one final
`assembleMonoPrompt` call removes the source of the repetition and keeps raw
commands first.

Role-specific cores are 657 characters for Grand Orch, 1,359 for Managers and
857 for members, bounded at 1,700 characters, with shared authority,
CLI, worktree and GitHub boundaries kept in the injected org block. Identity,
full soul and memory guidance remain separate. Plain Monos retain session
delegation and completion guidance; org agents use their role's existing
team/task routes. Safety refusals, user locks, merge/destructive limits,
untrusted reports, exact independent review and required artifacts remain.

Long-form source guidance is preserved in `docs/mono-rules/` and embedded in
the native executable. Fetch it with the injected executable:

```text
<app executable> app rules shell
<app executable> app rules team
<app executable> app rules artifacts
<app executable> app rules delegation
<app executable> app rules memory
<app executable> app rules habits
```

`app rules` lists topics; `app --help` retains action/JSON documentation.
Rules are local text and need no connection credentials. Exactly the verified
current executable plus `app rules <known topic>` is auto-approved, including
the constrained trusted PowerShell form. Unknown topics, paths, extra tokens,
flags, chaining and proxies are rejected. Rules cannot enter the credential
action dispatcher; help follows ordinary permissions. The offline rules route
uses CC5-A's checked output writer and fails with a controlled nonzero result
when stdout is unavailable. Read shell guidance once before the first CLI action, and the
other topics before the relevant work. A native rebuild is required to ship
these embedded texts.

The fixture's `<monocode_app>` explainer shrinks from 1,170 to 481 characters;
the exact action reference remains available with `app --help`.

Worker memory uses at most 4,000 characters of whole lines. Under pressure it
keeps user-owned undated lines, then newest live dated facts, with original
file order restored for reading; both `- ~~` and `~~` superseded forms are
excluded before selection, even when memory already fits. Facts
updated in place remain eligible by their new date. Oversized lines are
omitted, never rewritten. The full MEMORY.md path stays in the prompt for
read-only access; workers can ask their Manager for topic/archive searches.
Generic Mono memory storage and its existing 200-line/24-KiB budget are
unchanged. Soul is preserved in full and refreshed separately from memory.

Review tasks quote at most 2,000 characters of implementation evidence,
retain the exact task/dispatch/checkout and independent read-only review
instructions, and point to the complete report through `artifacts.read`.
For implementations without an artifact, the pointer is an authenticated
team-message request to the Manager for that exact task/dispatch result.
Workers do not receive pointers to unsupported control actions or unavailable
session/memory-read actions.

## Builder measurements and budgets

The reusable fixture contains Grand Orch plus three projects, each with one
Manager and four members (16 agents), a 500-character soul, 3,200-character
memory, six saturated prior exchanges and an 8,000-character implementation
result. Saturated worker rows use 24,000-character memory. Measurements call
the real org, Mono, rotation, task and final assembly builders. The baseline
reproduces the old App insertion paths from the unchanged starting revision.
Values are JavaScript string characters added by this context region, including
its wrapper, excluding the user/task request.

| Role / turn | Before | After | Reduction |
| --- | ---: | ---: | ---: |
| Grand Orch / first | 45,252 | 9,903 | 78.1% |
| Grand Orch / steady | 7,300 | 871 | 88.1% |
| Grand Orch / rotation | 71,020 | 22,787 | 67.9% |
| Manager / first | 49,766 | 10,729 | 78.4% |
| Manager / steady | 11,980 | 863 | 92.8% |
| Manager / rotation | 75,542 | 23,617 | 68.7% |
| Member home / first | 46,118 | 9,947 | 78.4% |
| Member home / steady | 8,350 | 857 | 89.7% |
| Member home / rotation | 71,910 | 22,843 | 68.2% |
| Worker / delegation | 9,103 | 8,534 | 6.3% |
| Worker / review | 17,856 | 11,373 | 36.3% |
| Worker / saturated delegation | 29,903 | 9,334 | 68.8% |
| Worker / saturated review | 38,656 | 12,173 | 68.5% |

First Mono turns are capped at 12,000 characters: full role/chart, identity,
soul, fixture memory and CLI, with approximately 1,600 characters of headroom
for the largest role. Steady unchanged turns cap at 1,000 and add 857–871
characters including the authority core and wrapper. Rotation caps at 26,000,
retaining the existing approximately 13,000-character recap. Worker delegation
caps at 9,500 and review at 12,500, allowing the fixed authority core, including
the saturated memory/report cases. These intentional bounds are fixture
regressions, not enforced truncation of arbitrary user-authored souls or
task briefs. They exclude unchanged orchestration/native suffixes, global
skills/plugins and provider history; they are not total model-input budgets.

The tests cover provider/model/account changes, changed roster/version,
acceptance versus rejected sends, corrupt/full storage, deleted/rewound
sessions, continued worker tasks, updated memory, fitting whole-line
boundaries, full-report recovery, role authority and single insertion for
Mono/member/operator/raw-command paths.

## Rollout measurement

The stdlib-only analyzer recursively reads Codex rollouts and maps roles using
org charts plus the supplied copied MonoCode database. It prints context sizes,
per-call latency, input tokens, compactions/TTFT and persisted handoff gaps:

```text
python scripts/measure-mono-rollouts.py --self-test
python scripts/measure-mono-rollouts.py <copied-mono-sessions> <copied-monocode.db> --extra-sessions <copied-worker-sessions>
```

It snapshots the supplied DB and WAL into disposable scratch and opens only
that snapshot with `mode=ro` and `query_only`; supplied DB/WAL/SHM and rollouts
stay unchanged. Supply a stable database copy. It prints statistics, never
prompt bodies or credentials. Context character counts use Python Unicode
code points; prompt-builder budgets use JavaScript UTF-16 string length.
Recorded call durations and turn-minus-unioned-tool-time/call estimates are
labelled separately. Worker completion to the next lead turn is an upper
bound, and unmatched dispatches/unknown roles remain visible.

Usage falls back per turn, with detailed usage authoritative within that turn.
Compactions are deduplicated by identity and timestamp across record formats,
preserving event-only history. Records lacking timestamps remain distinct.
Self-tests use synthetic nested trees, mixed-history token fallback, duplicate compaction
records, overlapping tools and an uncheckpointed WAL. A sanitized size-only
fixture from the allowed copied prompt extracts reproduced first Manager
62,428, later Manager 22,131, Grand Orch 40,452 and worker 22,905/18,537
user-message characters. No production latency improvement is claimed:
copied rollout JSONLs were unavailable and no live model turns were sent.

## Original CC1 validation and evidence

The required checks use Node 26 with
`NODE_OPTIONS=--no-experimental-webstorage`; native checks cover the changed
CLI module. Only the touched Rust file was formatted.

| Check | Result | Evidence |
| --- | --- | --- |
| Full `npx vitest run --maxWorkers 1` | 546 files passed, 2 skipped; 5,974 tests passed, 13 skipped; 0 failures; 578.49 s | `vitest-full.log`, `vitest-full-receipt.json` |
| Final focused context tests | 3 files / 33 tests passed, 0 skipped, 0 failures; 2.76 s | `focused-full.log`, `focused-full-receipt.json` |
| `npx tsc --noEmit` | Exit 0, no diagnostics; 13.318 s wall | `tsc-full.log`, `tsc-full-receipt.json` |
| `npm run build` | Exit 0; Vite 20.02 s, 33.247 s wall; existing CSS/minifier and chunk-size warnings | `build-full.log`, `build-full-receipt.json` |
| Native `cargo test --manifest-path src-tauri/Cargo.toml --lib control_cli::tests -- --test-threads=1` | 17 passed, 0 failed, 615 filtered; 1.09 s test time | Round-folder `rules-cli-verification.log` |
| Analyzer `--self-test` and sanitized copied-extract run | Exit 0; supplied DB/WAL/SHM hashes and mtimes unchanged | Round-folder `measurement-sanity.txt` |
| Rust formatting, guidance preservation and diff whitespace | Exit 0; baseline long-form guidance preserved verbatim | Round-folder `rules-cli-verification.log` |

The full suite collected the eight initial prompt tests before the final
continued-worker test and memory refinements. The final focused run covers
all 33 context tests on the finished source; the full-suite total above is
reported as observed and is not incremented by that later test. TypeScript
and the production build also ran on the finished source. The baseline size
capture passed one temporary test, which was removed after recording its
artifacts. `npm ci` installed 425 packages successfully; its existing nine
audit advisories were not changed by this round.

Evidence lives in `target/cc1-verification/baseline.json`,
`baseline-prompts.json`, `after.json` and validation logs/receipts, plus
`C:/Users/nooro/AppData/Local/Temp/monocode-cc/cc1/` for rule preservation and
analyzer source-byte/mtime checks. The original copied prompts/scripts are
under that program's `evidence/` folder. No push, merge, preview/model turn,
real agent-data edit, scheduler/effort change or skills/storage change was made.

## Original CC1 compaction follow-up

Provider compaction replaces the history that held the once-delivered org,
identity, soul and memory. Receipt identity alone cannot detect that loss.
The shared harness registry now invalidates both receipt types synchronously
on a normalized `context.compacted` event, before App batches or buffers it.
Normal turns, manual compaction and rewinds share that event handling; steering
keeps the installed callback. Successful manual compaction also emits the
signal when an adapter has no completion notification. Failed attempts without
an observed compaction keep steady context unchanged.

A per-send flag clears receipts again after acceptance, including when the
acceptance callback throws, because compaction can precede that callback.
App generation guards prevent obsolete edited-turn acceptance and fallback
callbacks from writing receipts or replaying buffered events. Runtime
invalidation independently protects both planners if receipt-deletion writes
fail while old receipts remain readable; each clears only after its own fresh
accepted receipt is stored. No prompt text or budget changed (version stays 25).

Explicit provider completions mapped:

- Codex: deprecated `thread/compacted` and completed `contextCompaction` items,
  verified against locally generated Codex 0.162.1 app-server types.
- Claude: parent-session `compact_boundary`, excluding child/foreign messages.
- OpenCode v1/v2: matching-session `session.compacted` /
  `session.compaction.ended`, before completion gates can consume them.
- Pi/OMP: result-bearing compaction end frames; aborted, skipped, failed and
  child frames are excluded, including OMP's automatic compaction events.

Grok's manual compaction is covered by the shared success fallback; its
telemetry event was not treated as an unverified automatic protocol signal.
Remote-host sessions bypass these local Mono/member/habit receipt planners.
Usage decreases and display strings are not compaction evidence.

Synthetic registry tests assemble the real first-turn/steady context and prove
auto compaction before/after acceptance, manual compact with/without a signal,
compaction followed by failures, failed storage writes, unaffected sessions
and restoration of omission after fresh delivery. CC1F adds the authority
core to those steady inputs and rejects cross-process persisted receipts
until a fresh accepted delivery is stored, even when invalidation writes fail.

| Check | Result |
| --- | --- |
| Full `npx vitest run --maxWorkers 1` | 547 files passed, 2 skipped, 0 failed (549); 5,992 tests passed, 13 skipped, 0 failed/todo (6,005); 600.18 s Vitest / 602.495 s wall |
| Focused compaction/context/provider/edit-turn suite | 16 files / 539 tests passed, 0 skipped/failed/todo; 24.65 s Vitest / 27.256 s wall |
| `npx tsc --noEmit` | Exit 0; 27.302 s wall |
| `npm run build` | Exit 0; Vite 30.31 s / 56.595 s wall; existing large-chunk warning |
| Earlier provider-only check | 9 files / 401 tests passed, 0 skipped/failed; 21.11 s Vitest / 24.281 s wall |
| Independent source reviews | No material issues in main or provider changes |

Checks used process-local `NODE_OPTIONS=--no-experimental-webstorage`.
Evidence is under
`target/cc1-compaction-verification/run-20261011T105151059989Z/`: raw logs,
focused/full Vitest JSON, `receipt.json`, and source snapshots at every
boundary. All 1,424 source/config file hashes stayed unchanged during checks
(aggregate SHA-256
`d8dd1679baa7226f3be863c202eaca054011dc231ef459b3b20cd061c4369a09`).
Provider schema/type proof and the earlier provider-only receipt are under
`target/cc1-verification/provider-compaction-protocol-evidence.txt` and
`providers-full-receipt.json`.

No native code changed, so the native suite was not repeated. No live model
turn, deployment, push or merge was performed; live compaction remains
unverified.

