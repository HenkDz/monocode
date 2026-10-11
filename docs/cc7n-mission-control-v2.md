# CC7N: Mission control v2 Cockpit

Mission control now opens the user-selected Cockpit direction from CC7M. The
command, attention strip, organization vitals and project agent grid remain
useful with zero goals. Live goals open a right drawer containing their saved
delegation chain, wall elapsed time, Phases/Ledger views and existing conversation
actions. Attention uses the same drawer and the original CC7D execution controls.

The work starts at `4a86188dba99a580814fbd8fa6f1e97a44bebdee` on
`HenkDz/cc7n-cockpit`. The coordinator owns integration into `nour`.

## Sources and honest gaps

`goalView.ts` and `timeline.ts` retain the goal, attempt, review and interval
joins. The small `cockpit.ts` presentation projection uses CC4's live-state,
metrics and delegation selectors and the existing member/task lookup. It joins
the current roster independently of goals, prioritizes current assignments over
old failures, and opens a blocked engine's exact conversation. Archived members
and terminal-goal failures cannot masquerade as current work. Windows project
keys use the same `pathKey` normalization as the goal ledger.

Unknown timing and counters say **—**. Active/idle counts come from canonical
agent states. Average hand-off uses only recorded dispatch-to-turn-start samples;
duplicate conflicting boundaries are excluded. Tokens today deduplicate loaded
session/turn identities and use CC4's cache conventions, with observed coverage
explicitly labelled and partial counters marked with **≥**. Goal totals are
never summed into organization totals. These are loaded-source statistics, not
a complete billing or latency dashboard.

The phase strip presents Planning, Working, Review, Waiting and Compaction as
navigation categories. Exact model/tool phase durations remain unknown. A review
says **Not started** only when its recorded attempts are still queued before a
turn begins. Captured wait and compaction intervals remain separate: overlapping
spans are never added. The ledger pages four rows and exposes actor, attempt,
review reference, exact boundaries, uncertainty and the saved conversation.

Recent activity uses completed dispatches and verified merged PRs. A merged PR
must match the task's saved URL; a reused branch cannot prove a new task merged.
Completion time comes from `finishedAt`, not a mutable update timestamp. Missing
completion timestamps remain unknown, and a completed review does not imply an
approved change.

The home strip and queue share the existing CI-repair and automation sources
through `useAttentionSources`. An automation failure without a conversation opens
the queue instead of navigating to an empty session identity. CC7D still owns
freshness checks, source acknowledgement, worker-to-lead authority, history,
approval/question handling, usage recovery and storage resolution.

## Interaction and integration

The self-contained `MissionCommandBar` reuses `MonoGoalRoute` and CC5C's router,
envelopes and existing App submission adapters. Chat goes to Grand Orch. New
goal uses the existing exact project matching and override safeguards. Pending
or uncertain acceptance retains the original request and route; a rejected
request keeps the draft. Repeated Send cannot submit a pending request twice.
Enter submits, while Shift-Enter and IME composition retain text editing.

The marked **CC7N shell hook** in `App.tsx` adds the command callback, verified PR
statuses and the hosted Attention queue using the existing callbacks. It replaces
the old timeline-page route import with the existing Mission control route and
scope. `MonoComposer`, `SessionPane`, `ModelPicker` and their wiring remain with
UP1. There is no new execution path, grant, provider parsing, dependency, storage
schema or native change.

Project, state and comfortable/compact choices persist in browser storage.
`/` focuses the command; `j`/`k` traverse cards and live goals; Enter opens the
focused item. Drawers reuse the house Modal's focus trap. Pointer openers are
explicitly focused for WebKit, Escape restores their focus, and nested Evidence
popovers consume Escape before the drawer. The hidden route releases shortcuts
and stops its elapsed timer. Card descriptions expose activity and canonical
state to assistive technology.

Sidebar group accordions are removed. Active members stay as rows with canonical
state dots and accessible labels; idle members appear as **Available** chips.
Worktree and task history use **Active / All** segments and five-row paging,
reusing CC7A's persisted preferences. Selected, unread, attention and dirty items
stay pinned independently of paging. Arrow navigation and existing task/session
detail and safety actions remain. Narrow rails hide only visual status text,
preserving the full accessible description and token-colored dot.

## Decisions and limits

The CC7M mockup controls typography, spacing, surfaces, grids and right-drawer
proportions. Real source labels and identities replace synthetic wording. The
implementation adapts at 1440, 1100, 900 and 800 px in both themes. It retains
existing shell navigation and per-project sidebar organization.

Rejected alternatives: a new composer, fuzzy/model routing, a second goal ledger,
reconstructed provider phases, inferred blocker onset, invented billing/cost,
an organization sum of overlapping goal totals, an always-visible ledger,
sidebar group disclosures and a separate stacked detail destination. Large-roster
virtualization and broader steering remain outside this round.

All validation and screenshots use synthetic sources and isolated homes/browser
profiles. They establish frontend projection, interaction and callback behavior,
not native lifecycle or live-provider acceptance. No live model turn, real
profile/database change, other-worktree mutation, merge, rebase, push or deployment
was performed.

## Evidence

Evidence root: `C:/Users/nooro/AppData/Local/Temp/monocode-cc/cc7n/evidence/`.
`mockup/` records the original browser walkthrough; `final/` records the final
real-component harness, and `comparison/` puts the required screenshots beside
the mockup. The committed harness is `tests/browser/mission-control.*` and renders
the real Cockpit, command, Attention queue, Manager rows and worktree controls.
`validation/initial/` preserves provisional runs; `validation/final2/` binds the
final full checks to source hashes. The round's `REPORT.md` records the resulting
commit and exact validation totals.

## Validation

Windows / Node 26.5.0 checks use `NODE_OPTIONS=--no-experimental-webstorage`,
four Vitest workers and synthetic homes with `CODEX_HOME` and `ORCA_*` removed.

| Check | Final result |
| --- | --- |
| Full unfiltered Vitest | 595 files passed, 2 skipped, 0 failed; 7,090 tests passed, 13 skipped, 0 failed/todo; 597 files / 7,103 tests total. |
| Focused command-center checks | 11 files, 187 tests passed, 0 failed/skipped. Included in the full suite. |
| `npx tsc --noEmit` | Passed, exit 0; 25.246 seconds. |
| `npm run build` | Passed, exit 0; 54.516 seconds, Vite 26.51 seconds. |
| `npm run test:browser` | 110 tests: 109 passed, 1 known WebKit video failure, 0 skipped/flaky; 179.231811 seconds. |
| Cockpit browser cases included above | 20 passed, 0 failed/skipped across Chromium and WebKit. |
| Original mockup walkthrough | 16 layout cases, 149 checks passed, 0 failed; 13 screenshots. |
| Final real-component capture | 16 cases; 23 screenshots; 6 side-by-side comparison images; minimum sampled text contrast 5.35965:1. |
| Native checks | Not applicable: no native or host changes. |

Final Vitest takes 124.37 seconds (125.172 seconds process time). The two
Antigravity real-provider suites account for the 13 existing skips. Build retains
the two transcript `::highlight` CSS warnings, the mixed `mono.ts` import notice
and large-chunk advisory. No test or timeout was weakened.

`validation/final2/` contains the successful full run and source snapshots.
Only the storage-Evidence selector in the browser spec changed during Vitest;
browser specs are outside that suite. The subsequent TypeScript/build snapshot
has zero source drift. All production bytes remained stable throughout. The
earlier `final/` logs preserve a passing full suite and a type/build failure from
two missing synthetic Automation timestamps; those fields are corrected.

The sole browser failure is the unchanged Windows WebKit Blob-MP4 test
`tests/browser/video-preview.spec.ts:3`: metadata readiness is false with media
error code 4. It remains neither skipped nor weakened. Final browser source
hashes exactly match the capture's 32 source hashes. Previews and synthetic
browser homes are stopped/removed; right drawers reach the viewport edge and
remain at most 470 px wide, with settled opacity 1.

The earlier provisional full-browser run used 1440×1000 instead of the repo's
1000×800 default viewport and had 107 passes / 3 failures: the same existing
resize assertion in both engines plus the video failure. Correcting only that
runner setting leaves the video failure. Raw evidence is retained under
`provisional-full-before-attention-polish/`; its source drift is explicitly
recorded. The final run uses the original test directory, projects and viewport,
with only launch-folder/port paths adjusted for isolation.
