# CC5CH: conservative routing and retained goal identity

Sentence punctuation could hide a second project and send cross-project work to one Manager. Project archival could also overwrite an acknowledged goal receipt while cancellation waited, and an uncertain retry could call Grand beneath its retained Manager chip. This round closes those three CC5CG-R findings without changing goal authority, the outbox, storage schemas or the composer contract.

## Routing rule

Automatic routing still needs the existing exact, unique registered project name and an available local Manager. Conflict detection independently lowercases the text and every registered name, removes Unicode punctuation and whitespace, and rejects the Manager if another registered project's normalized name occurs anywhere in the normalized text. Unavailable and archived Manager identities remain candidates. Explicit project selection uses the same conflict check and displays the conflict before Send. Any path-like token still means Grand in Auto; a selected chip permits paths only when the conservative name check also passes.

`Fix Atlas and Beacon.`, `Fix Atlas. Update Beacon` and `Fix Atlas... and Beacon` now stay at Grand. The policy deliberately over-blocks short common-word names (`Go` in `goals`), overlapping names (`Atlas` and `Atlas API`), punctuation/whitespace-split names, duplicate normalized names, other names inside file paths and punctuation-only names. The existing exact positive matcher can still conservatively refuse `Fix Atlas.`. No model classification or filesystem alias resolver is needed.

## Archival and retries

After cancellation settles, project archival calls the existing App session writer with `archiveMonoConversation` as a mutation. That writer selects and publishes current state inside the shared session-store write boundary. A goal receipt acknowledged during cancellation remains queued and paused after archive/restore, with explicit Resume still required. The stale snapshot publication and redundant persistence call were removed.

When a Manager envelope becomes unavailable, fallback awaits the origin check. App checks the full durable history inside the same session write boundary when the original identity is absent from live memory, and validates its text and envelope. A durable origin stays on its original route with a blocked card. The recovery merge retains unpublished durable goal origins in the writable tail; publication and subsequent ordinary saves preserve them while older origins stay off the displayed page.

An unreadable store retains the original chip, draft and IDs with `Checking previous send… Retry original when storage is available.` A proven missing origin returns rejection, refreshing the chip before a new Send; that retry does not call Grand under its previous Manager chip. Existing composer handling allocates new IDs when the route changes. Embedded and floating use the same adapter and existing accepted/rejected/uncertain transport, so no new UI state machine was added.

## Validation

Windows, Node 26.5.0, npm 11.17.0; all Node checks used RTK and `NODE_OPTIONS=--no-experimental-webstorage`. `npm ci` installed the unchanged lockfile. Validation ran on the final changed source/test contents from base `b94219ab8cadfd066c64beca20d0f00f0a2665b0`; the report records the resulting local commit. Source hashes bind those contents to the validation receipts.

| Check | Result | Tool / wall time |
| --- | --- | --- |
| Full `npx --no-install vitest run --maxWorkers=4` | **7,262 passed, 13 skipped, 0 failed**; 7,275 total. 604 files passed, 2 skipped, 0 failed; 606 total. | 101.24 / 102.749 s |
| Routing, retries, history and connected writer subset of the full run | **212 passed, 0 skipped, 0 failed** in five files, including six failure-before-App-publication cases across embedded/floating. | Included above |
| Resolver-only focused run | **61 passed, 117 filtered skips, 0 failed**; includes 3,456 generated punctuation-context decisions. | 2.07 s / see receipt |
| Archived CC5CG-R routing reproductions against current source | **79 passed, 0 skipped/failed**, three files; all six prior expected-safe failures pass. | 3.55 / 5.138 s |
| Connected archival reproduction before repair | **1 expected-safe failure**, 0 passed, 10 filtered skips: one acknowledged receipt became zero. | 1.55 / 3.105 s |
| Connected archival reproduction after repair | **1 passed, 0 failed**, 10 filtered skips; entire writer file **11 passed, 0 skipped, 0 failed**. | Full writer file 3.55 / 5.268 s |
| `npx --no-install tsc --noEmit` | Exit 0, no diagnostics. | Not emitted / 16.287 s |
| `npm run build` | Exit 0; existing CSS/import/chunk warnings remain. | Vite 16.18 / 34.043 s |
| `npx --no-install playwright test tests/browser/cc5c-routing.spec.ts` with isolated external config | **8 passed, 0 failed/skipped/flaky**; Chromium/WebKit, embedded/floating, dark/light, Auto/explicit conflicts and submission. | 40.8 / 43.084 s |
| `git diff --check` | Passed. | Not measured |
| Cargo | Not applicable: no native source changes. | — |

Counts overlap and are not additive. The 13 full-suite skips are existing Antigravity real/soak cases. Browser validation used an empty launch folder, identifier `com.monocode.cc5ch.validation`, synthetic projects/IPC, fresh browser contexts, and cleared `CODEX_HOME`/all `ORCA_*` variables. Its owned preview stopped; cleanup found no remaining listeners or owned preview processes. Twenty-four screenshots include eight explicit-chip conflicts; the builder inspected embedded-dark Chromium and floating-light WebKit conflict images.

Evidence root: `C:/Users/nooro/AppData/Local/Temp/monocode-cc/cc5ch/evidence/`. `validation/` holds full logs, JSON results, command receipts, source audits, browser isolation/cleanup and screenshots. `archive/` holds the original failing receipt and corrected connected reproduction. `routing-review/` reruns the archived routing controls and connected cases; two explicit selections mentioning Beacon now expect Grand, and asynchronous Manager replacement expects rejection before a fresh Send. Those are documented final-policy adaptations; the six original failing assertions are unchanged, and original reviewer fixtures remain untouched. `conservative-routing-tests.log/.json`, `conservative-routing-receipt.json` and `conservative-routing-notes.md` record focused matching checks. The external `cc5ch/REPORT.md` records the branch, commit and file list.

## Decisions and limits

Reused the existing exact matcher, session writer, recovery helpers, ledger and composer acknowledgement handling. Rejected another punctuation boundary parser, fuzzy/model routing, new stores/schedulers/dependencies, early archive snapshots and immediate Grand fallback from a stale Manager envelope. Current normalized substring conflicts are intentional conservative policy, rather than a shortcut awaiting broader matching.

Full-history scans remain an inherited cost while holding the session queue; large-history latency and first-failed-receipt recovery fairness remain follow-ups. Native storage faults and delivery are synthetic in these tests. No real profile, native desktop/floating lifecycle, live model/provider turn, production latency, Cargo/native build, unrelated refactor, dependency remediation, BOARD edit, other-worktree mutation, merge, rebase, push, deployment or shipping was performed. The coordinator still owns review and integration.
