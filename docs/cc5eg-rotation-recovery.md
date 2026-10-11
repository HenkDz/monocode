# CC5EG: context rotation recovery

The CC5EFR ship gate found two recovery defects: edited resend could rewind away
pending constraints, and an oversized input allowed before the initial detach
could block all later retries. CC5EG repairs the retained task path without
changing accounts, checkouts, provider permissions or the earlier conversation.

## Recovery behavior

App now requires a valid pending carry plan before it can commit a retry or
start an edited provider turn. Edited resends reattach the original constraints
and retained assignment while replacing only the selected failed input. Other
unaccepted inputs remain. The replacement carry is saved before rewind; an
unavailable store leaves the provider untouched. Missing boundaries, unresolved
activity and provider switches refuse the attempt with a plain explanation.
Both composer planning and submission use the same replacement blocks.

Initial refresh checks include the next input in the protected 8,000-character
allowance and reserve its full retry representation within 14,000 characters.
Request IDs are preserved; repeated identical text is counted once. Pending
retry size refusal happens before transcript commitment, keeping the input
correctable. Initial oversized drafts can be trimmed or sent after successful
manual compaction of the existing provider. Compaction is no longer advertised
as a way to shrink already saved pending inputs.

## Design decisions

The brief permits either rejecting pending edits or preserving their carry.
Preserving the carry uses the existing explicit edit workflow and also lets an
eligible retained task recover an oversized pre-release failed input. A global
edit lock would remove that recovery path. No new editor, dependency, settings,
storage schema or provider API was needed. Protected constraints are never
truncated, caps are unchanged, and compaction is never treated as acceptance.

The original pending brief remains the authority for pre-rotation constraints
and the retained assignment. Only removed failed request IDs and their inputs
are replaced; duplicate text belonging to a surviving stored request stays.
If rewind fails, the unchanged transcript remains available for ordinary retry
to rescan. A successful rewind has the saved replacement carry available even
if the next startup fails.

## Validation and evidence

Source revision: `1bac845d915d41d60c76409ecaf9781a76aa08fb`.
Windows web commands use `NODE_OPTIONS=--no-experimental-webstorage`.

The focused five-file suite passes 145 tests, zero failed or skipped. It covers
the actual OpenCode adapter's prompt admission followed by transport failure,
actual Stop cleanup and rewind, then accepted delivery of the earlier restriction
and assignment. It also covers initial and retry size checks, duplicate inputs,
preserved other failures, storage-save refusal, switches/activity guards, unknown
edit boundaries, real App compaction, and real context-meter interactions.

Full suite, TypeScript and build receipts are saved at
`C:/Users/nooro/AppData/Local/Temp/monocode-cc/cc5eg/validation/`.

| Check | Result | Wall time |
| --- | --- | ---: |
| Focused five-file Vitest | 5 files, 145 tests passed; zero failed or skipped | 9.161 s |
| Full `npx vitest run --maxWorkers=4` | 590 files passed, 2 skipped, zero failed; 7,063 tests passed, 13 skipped, zero failed | 107.933 s |
| `npx tsc --noEmit` | Exit 0, no diagnostics | 22.857 s |
| `npm run build` | Exit 0; existing CSS/import/chunk warnings | 43.418 s |
| Native tests | Not applicable: no native source changed | — |

Node 26.5.0, npm 11.17.0. Source start/end manifests cover 1,575 files and
match SHA256 `e92d0f6031cedd41816ebc94e2518937243ab26f9608c4e7511cc84f2b1f2d35`.
The source diff stayed empty during all final gates; only documentation changed.
The 13 skipped tests are the existing Antigravity real/soak suites.

An earlier implementation-focused run passed 74 tests and failed one new
compaction fixture: its 1,000-token window was too small for the input even
after zero occupancy. The corrected fixture uses the review's million-token
window; the final focused and full gates pass. The adapter fixture's initial
static-import setup failed before test collection and was corrected to use its
existing dynamic-import pattern. Neither issue remains at the validated source.

Review inputs and original reproductions:
`C:/Users/nooro/AppData/Local/Temp/monocode-cc/cc5efr/REPORT.md` and its
`evidence/rotation-safety.md`, `rotation-edit-repro.test.ts`,
`independent-budget.test.ts` and `independent-pane.test.ts`.
Baseline: `C:/Users/nooro/AppData/Local/Temp/monocode-cc/FINDINGS.md`.
Final inventory and commit SHAs: the CC5EG `REPORT.md`.

## Limits

Adapter HTTP/SSE and native calls are synthetic fixtures; no live model turn or
desktop acceptance was run. No native source changed. UP1 must preserve the
small SessionPane edit-planning change during its composer/layout integration.

Existing primary Mono/org chats intentionally hide Edit. Codex requires an
accepted provider turn ID; other providers need rewindable message history.
Older pre-release oversized carries outside those conditions remain protected.
The new initial bounds prevent their creation in the reviewed failure sequence;
this round does not migrate or reset real profile data. Original oversized
constraints still defer rotation, as the existing policy requires.

No push, merge, other-worktree mutation, live preview, dependency change, profile
reset or native storage change was performed. Live latency and compaction-rate
targets remain rollout measurements.
