# CC5EJ: rotation continuity and completion queue recovery

Retry could omit protected continuity when a valid JSON entry was incomplete,
or when its saved carry changed after planning. Completion-only queues could
also remain paused after storage recovered. This repair refuses uncertain or
stale continuity and lets the existing Retry action resume retained completion
events.

## Revisions and scope

- Branch: `HenkDz/cc5ej-rotation-continuity`.
- Base: `f0e368f2b85361bdae7af005ace5c6d2953b7a63`.
- Final implementation: `9e764721b33f0d6f50e69aeaa0de2e8a39da1191`.
- Final documentation SHA and branch tip: external `cc5ej/REPORT.md`.

The implementation changes `monoRotation.ts` and small local App callbacks,
with regressions in the existing rotation recovery, edit and App tests.
No native permission, working-folder relocation or orchestration scheduler
implementation changed. The available code graph points to an older CC4
checkout; current source, callback extraction and SHA256 receipts establish
this revision's behavior.

## Storage and receipt decisions

The storage boundary checks required fields, supported reasons, optional field
types and pending-state consistency. Pending inputs require a nonempty brief.
Unknown entry fields may hold future authority and therefore fail closed.
Invalid entries keep their bytes: no deletion, truncation or reconstruction.
Settled entries without pending fields and legacy `idle`/`restart` reasons,
including pending-brief-only carries, remain supported.

The planner returns a complete pending carry and its expected saved receipt.
The existing writer accepts an optional expected receipt: null means expected
absence, while an omitted argument preserves existing unconditional writer
callers. A full receipt comparison rejects a stale plan before saving or
detaching context. Both awaited context preparation windows check the receipt
again before provider delivery. Busy follow-ups, outgoing handoff and edited
rewind preparation retain the same guard. No separate persistence layer or
scheduler was added.

Receipt comparisons account for an accepted carry's effective settled state
while durable clearing retries. Acceptance advances the submitting closure's
expected receipt to settled state for any subsequent repair turn. A newer
writer remains protected from stale acceptance and later dispatch.

Rejected alternatives: infer missing scope, reset corrupt continuity, compare
only timestamps or readability, silently overwrite newer receipts, automatically
replan after side effects, or broaden prompt budgets. Refusal lets ordinary
Retry run every existing budget and safety check against the latest authority.

## Queue and connected callers

Automatic delivery, Resume and the orchestration Resume caller use the combined
queue head. Refusal and exception paths mark the retained item retryable in
either `queuedMessages` or `pendingMonoEvents`; Resume clears those errors for
completion-only recovery. Existing busy, approval, membership, usage-limit,
Codex account repair, folder and archive-delivery guards remain in place.

Ordinary input, Edit, queued messages/events, managed digests, routed goals,
habits and folder/storage reentry all reach the shared local preflight.
Remote submission still routes to its existing host boundary before this local
rotation policy. Source/provider-boundary fixtures establish these connections;
they are not a mounted App or native end-to-end acceptance test.

## Validation

Windows; Node 26.5.0, npm 11.17.0, Vitest 3.2.7.
All web processes use `NODE_OPTIONS=--no-experimental-webstorage`.
The full suite uses `--maxWorkers=4`; no deadlines, skips or safety assertions
were changed, and no full-suite retry was needed.

| Check at final implementation | Result | Wall seconds |
| --- | --- | ---: |
| Full Vitest | 622 files passed, 2 skipped, 0 failed; 7,893 tests passed, 13 skipped, 0 failed/todo | 151.3181343 |
| TypeScript `--noEmit` | Exit 0; no diagnostics | 22.9970296 |
| Production build | Exit 0; existing warnings | 46.0704194 |
| Changed-area six-file suite | 119 passed, 0 failed/skipped; 32 added cases | 4.11 runner |
| Earlier external fixtures | 13 files, 129 passed, 0 failed/skipped | Per-family receipts |
| Earlier focused source union | 24 files, 625 passed, 0 failed/skipped | 17.76 runner |
| Retained assertion runners | Three A/B/C runners; writer 6, remote/host entrypoints 5, migration 3 and shared preflight 10 checks pass | Per-run receipts |
| CC5EIR expected-safe contract on base | 3 passed, 6 failed, 0 skipped; exit 1 | 4.7987938 |
| Same nine final safety cases after repair | 9 passed, 0 failed/skipped/todo; exit 0 | 3.1847432 |

The 13 existing skips are Antigravity real/soak cases. External, focused and full
counts overlap. All earlier 129 external and 597 focused names remain present
and passed. Historical source/package hashes for 1,416 files match before and
after execution; required gates also have unchanged HEAD and source receipts.
No native test was required because native source did not change.

The exact-source contract fixture was regenerated. Import paths, selectors,
callback dependencies and the isolated callbacks' enclosing refusal handling
were adapted. Its obsolete incidental assertion expecting a queue to stay
paused after Retry changes to expect healthy recovery; all nine final safety
assertions remain unchanged. A retained AST inventory records the comparison.

Failures retained: initial dependency absence; bootstrap receipt hashing with
an unavailable PowerShell cmdlet; duplicate worker flag before focused collection;
contract duplicate imports, an expected refusal escaping its isolated test
wrapper, and a summary reader using the wrong skipped-status spelling.
Correcting these external setup issues required no product edits or
weakened safety assertions. The six base contract failures are product failures.

## Evidence, cleanup and limits

All external paths are under
`C:/Users/nooro/AppData/Local/Temp/monocode-cc/cc5ej/`:

- `validation/SUMMARY.md`, raw logs/results and before/after receipts.
- `evidence/historical/INVENTORY.md`, `REVIEW.md`, executed case inventory,
  fixture provenance, adaptations and `final-combined-receipt.json`.
- `evidence/contract/REVIEW.md`, `AUDIT.md`, base/final results, observations,
  source hashes, source anchors and assertion preservation receipts.
- `REPORT.md`: final revisions, files, validation and round status.

A malformed or unknown entry conservatively makes the whole rotation map
unreadable; unrelated local sends can also defer until storage is restored.
No automatic repair of unknown authority is attempted. Synchronous receipt
checks do not establish a cross-renderer transactional compare-and-swap or
real multi-window schedule. Existing renderer-exit replay during a durable
clearing outage and separate native transcript/carry writes remain limits.

No real profiles/databases, other worktrees, BOARD, native source or dependency
manifests were modified. Local dependencies were installed without lock changes.
Existing npm advisories and build warnings remain recorded. Test/build processes
completed; no preview was started. Synthetic fixtures remain as evidence.
No live model turn, browser/native runtime acceptance, remote-network acceptance,
merge, push, deployment or shipping approval is claimed. An independent final
review follows builder completion.
