# CC5EH: rotation recovery without pending edits

Branch: `HenkDz/cc5eh-rotation-simplify`.
Starting revision: `b94219ab8cadfd066c64beca20d0f00f0a2665b0`.
Implementation: `f426f92d304988ab9904149c90f062d0eaeb1d6e`.

The CC5EGR ship-gate review reproduced an abandoned replacement entering a
later ordinary retry after provider rewind failed. CC5EH removes the
pre-rewind replacement save and blocks pending edited resend before storage
preparation. The visible Edit button, keyboard recall, preparation helper and
rotation planner enforce the same policy. The explanation is: "Retry the
original first. Editing is available after it's accepted."

An allowed edit after acceptance keeps the existing provider rewind and failure
recovery. Primary Mono and org chats retain their existing no-Edit behavior.
Rolling back staged replacements was rejected because disabling this narrow
recovery case removes the unsafe transaction entirely.

## Durable acceptance and explicit discard

A failed acceptance-clear write emits a small chat/live-state warning and
retries after 250 ms, doubling up to 30 s. Provider acceptance stays successful
and CC4 keeps its working/completed status. The exact accepted receipt appears
settled to the running app while its storage clear is retried. A newer carry,
discard or deletion cancels stale retries, including same-timestamp changes.
Read failures defer writes rather than overwriting other saved carries.

Oversized pending carries on primary Mono, org and retained task chats expose
"Discard pending input". The confirmation shows every saved/visible unaccepted
input in full and saves only after confirmation. Cancel, stale confirmation,
read failure and write failure leave the carry intact. The original brief,
earlier accepted constraints, assignment, references and visible transcript
remain. Discarded failed block IDs persist so later planners do not absorb
their visible historical text again. Resetting the whole carry or silently
discarding text was rejected because either would lose user constraints.

The original saved boundary must be loaded before discard can establish which
inputs are unaccepted. This path fails closed for an unloaded boundary; load
the earlier conversation first. Manual compaction cannot shrink saved inputs.

## Verification

Windows, Node 26.5.0, npm 11.17.0, Vitest 3.2.7. All web commands used
`NODE_OPTIONS=--no-experimental-webstorage`. Full tests and production
compilation ran sequentially with four Vitest workers. Source hashes from
every required gate match the implementation commit; the focused check and
standalone TypeScript check ran on its identical uncommitted source before
the implementation commit. This document is a later documentation change.

| Check | Result | Captured wall time |
| --- | --- | ---: |
| Full `npx vitest run --maxWorkers 4` | 606 files passed, 2 skipped; 7,266 tests passed, 13 skipped, 0 failed | 155.793 s |
| `npx tsc --noEmit` | Exit 0; no diagnostics | 17.963 s |
| `npm run build` | Exit 0; Vite 38.88 s | 72.250 s |
| Focused eight-file suite | 242 passed, 0 failed/skipped | 8.759 s |
| Independent actual-adapter fixtures | 4 files; 20 passed, 0 failed/skipped | 5.922 s |
| Independent writer/App checks | 6 passed, 0 failed | 1.687 s |
| Native checks | Not required; no native source changed | — |

Regressions cover blocked preparation/rewind, abandoning an edit, reload and
ordinary original-only retry; enabled Edit after acceptance; allowed-edit
rewind/send failures; acceptance clear/read failures, backoff and stale receipts;
primary/org/task confirmation, cancel and stale discard; preserved earlier
identical constraints; discarded block reabsorption; accurate CC4 status and
the actual pane warning. Synthetic transports exercise OpenCode, Pi, Codex
and Claude. The session-writer checks hold a same-session writer and prove
carry clearing neither deadlocks it nor loses the live refreshed snapshot.

An initial combined focused run had 240 passing tests and one failure: a
prototype storage spy did not inject the requested write failure in happy-dom.
Replacing that fixture with explicit fault injection corrected it; the final
focused and full suites pass. During implementation a missing App helper
import was also corrected before the required TypeScript gate. Initial runner
setup needed a .NET hash fallback for unavailable `Get-FileHash` and handling
of native stderr without treating warning output as an early script exit.
The failed focused run is retained as `validation/focused-initial.*`.

The 13 skips are existing Antigravity real/soak cases. Production output keeps
the existing CSS highlight, mixed static/dynamic import and large-chunk warnings.
Local `npm ci --no-audit --no-fund` installed 428 packages without dependency
or lockfile changes; npm reported the pending esbuild install-script warning.

## Evidence and limits

Evidence root: `C:/Users/nooro/AppData/Local/Temp/monocode-cc/cc5eh/`.

- `validation/`: focused/full JSON results, logs, command wrapper, per-gate
  source hashes/receipts and `summary.json` with final source alignment.
- `evidence/final-reproductions-receipt.json`: committed revision and unchanged
  source hashes for actual adapter and writer reproductions.
- `evidence/reproduction-review.md`, `adapter-*`, `writer-regressions.*`:
  independent fault fixtures, counts, literal occurrence receipts and commands.
- `evidence/model-results.json`: delegated model regression results.
- `REPORT.md`: final commits, complete changed-file inventory and round status.

The in-memory accepted view cannot survive app exit before a successful
durable clear. Reload during a persistent storage outage can still encounter
the old saved carry. Carry storage and native transcript storage have no atomic
transaction; no cross-process or native disk-timing guarantee is claimed.

Delivery is not literally exactly once: original restrictions can occur in
recent conversation and protected user requests, and retry input can occur in
both its wrapper and the current prompt. Independent fixtures observe the
original restriction twice, assignment once and each structural carry block
once, with abandoned replacement text absent. Lost acknowledgments can also
cause retry of already stored input. Prompt deduplication and transport-level
exactly-once delivery remain outside this repair.

No live model turn, desktop/native preview, native build/test, real profile or
database write, other-worktree change, dependency update, merge, rebase, push,
deployment or shipment was performed. Coordinator integration and live
provider/native acceptance remain separate checks.
