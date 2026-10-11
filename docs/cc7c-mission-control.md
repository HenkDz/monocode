# CC7C: Mission control

Mission control adds a goal-first destination to the existing shell. Live goals
lead, with Finished history collapsed below them. Each goal shows its full title,
project, wall elapsed time and recorded tokens, followed by Grand Orch, Manager
and worker assignments. Canonical state reasons remain visible beside the work.

The starting application commit is `a6677f60325f98af4d139340da68a8746301bc99`.
This round stays on `HenkDz/cc7c-mission-control`; no other worktree, branch or
user profile is changed.

## Data and accounting

`src/features/commandCenter/model/goalView.ts` projects the existing goal ledger,
roster, runs and sessions. It consumes CC4's `selectAgentLiveState`,
`selectAgentMetrics`, `selectTaskMetrics`, `selectGoalMetrics` and
`selectDelegationEdges`. It does not capture provider events or recalculate their
cache conventions. Goal tokens are normalized total input including cache plus
output. Cached input is not added a second time.

Goal totals deduplicate attributed turns within that goal. Shared Grand and
Manager conversations show only attributed contributions; unrelated turns are
excluded. Independent goals can share a Manager report turn, so their displayed
totals overlap and there is no org token sum. Partial counters are labelled
partial; absent counters remain unavailable. A recorded zero remains zero.
There is no cost source, so cost is unavailable.

Manager chat state and engine accounting have separate sources. A durable chat
blocker remains visible when its engine is busy. A separate engine blocker opens
that exact engine conversation. When both conversations have accounting, their
contributions are labelled separately using CC4's per-session selector.
Filtering a shared busy conversation cannot turn an older goal's unfinished
turn into current work.

Wall elapsed is measured from a live goal's saved creation time. Finished goals
have no durable goal-finish timestamp, so their wall elapsed stays unavailable;
mutable `updatedAt` and summed provider turn durations are not substituted.
Leader nodes label observed turn time; workers label current-attempt elapsed.
Unavailable historical attempt boundaries remain unavailable.

## Chains and attention

Chains use saved goal, Manager, task and dispatch identities. Missing or cyclic
roster links produce a visible explanation without losing the saved assignments.
If the origin roster entry is missing, the exact saved user-message identity can
still locate its loaded conversation. Project filters use project identity,
including when two folders have the same display name.

Retries remain in an Attempts disclosure; worker navigation uses the current
dispatch session. Reviewer rows identify the reviewed task and exact dispatch.
Legacy reviews without a goal ID inherit it through a cycle-safe, read-only
projection of their saved review link. Scheduling dependencies do not become
delegation parents. Missing review references remain visibly unavailable.

The attention banner is intentionally limited to existing canonical human
requests on Grand/Manager conversations and known storage or usage blockers.
It deduplicates shared conversation issues and says that its scope is all
projects. Worker approval and decision requests remain lead-routed rather than
being counted as direct user approvals. Their Resolve action invokes the existing
approval navigation path. Ordinary dependency waits and task failures do not
become invented user requests. The full attention queue belongs to CC7D.

## UI and integration

`MissionControl.tsx` subscribes to the existing roster and goal stores and receives
the shell's current runs and sessions. The mounted view preserves its project
filter, Finished disclosure and scroll position when a conversation is opened.
The live elapsed clock stops when the destination is hidden. Conversation-opening
errors are visible in the goal view.

`GoalChain.tsx` uses the shared `AgentStatusLabel`, renders the state reason as
readable text and links to existing member/session views. At 900 px, workers wrap
below their Manager; at 390 px the complete ordered chain stacks. Long titles and
identifiers wrap without discarding nodes. Native disclosures, labelled controls
and visible keyboard focus remain available in both themes.

The marked shell hook is confined to `App.tsx` and `shell/Sidebar.tsx`.
Mission control reuses the existing Team map full-view lifecycle with the reserved
`command-center:mission-control` scope, so existing Back, Escape, view exclusivity
and project/session navigation close it. The small `openGoalTarget` adapter closes
that full view before lead request routing, including missing-roster destinations
whose session tab is already open. The visible view claims Escape in capture,
using the same guard as Team map, so the shell cannot stop a hidden busy session;
the hidden view does not claim Escape. Sidebar entry points cover expanded,
compact and project-picker modes outside CC7A's `ProjectRail.tsx`.

Alternatives rejected: another provider capture/metric layer, an org sum of
overlapping goal totals, inferred cost or completion times, title-based joins,
a second approval/steering execution path and a new independent shell state that
would need changes in every view-closing handler. No dependencies or native files
were added or changed.

## Automated validation

Final Windows / Node 26 checks use
`NODE_OPTIONS=--no-experimental-webstorage`. The full suite runs with four workers
to bound concurrent test processes; no test filter or new skip is added.

| Check | Result |
| --- | --- |
| Full Vitest suite | 563 files passed, 2 skipped, 0 failed; 6,298 tests passed, 13 skipped, 0 failed; 565 files / 6,311 tests total |
| CC7C focused checks | 25 passed, 0 failed across 2 files: 18 projection/navigation and 7 UI tests |
| `npx tsc --noEmit` | Passed |
| `npm run build` | Passed |
| `git diff --check` and staged diff check | Passed |
| Native tests | Not required: native and host files unchanged |

The existing two Antigravity real-provider suites account for all 13 skipped
tests. No CC7C test is skipped. Full-suite totals come only from the final run;
earlier and focused runs are not added to them. Focused assertions cover shared
sessions, timing and token scope, missing/cyclic links, retries/reviews, unknown
telemetry, zero counters, long titles, distinct project identity, attention
routing/deduplication, history/return state, navigation failure and guarded Escape.

The evidence root below contains `validation-run3-vitest.json` and its raw log,
`validation-run3-receipts.json`, assertion-checked `validation-summary.json`,
focused receipts and earlier run logs. The first
full run had 6,297 passing tests before the final target-routing test; the second
had 6,298 before the Escape handler changed. Both passed and are retained as
pre-final evidence. The final full run contains all 25 current CC7C tests.

The final full suite took 159.50 seconds in Vitest (162.105 seconds wall time);
TypeScript took 31.069 seconds and the build 49.424 seconds (Vite 24.74 seconds).
The build retains two existing CSS `::highlight` warnings and the large-chunk
advisory. Native, host and dependency files are unchanged.

## Browser evidence

The isolated React harness in `src/features/commandCenter/fixtures/` renders the
implemented view through the real projection and CC4 types. Its synthetic data
contains two live goals sharing Grand/Manager conversations, a storage-blocked
Reviewer, exact review linkage, running tool activity, long titles and Finished
history. It uses no app database, native runtime or provider turn.

Browser acceptance passed **355 checks, 0 failed**, with **eight screenshots**:
dark/light at 1440, 900 and 390 px, plus dark/light 390 px at 200% text size.
All source hashes matched the final capture. Sampled normal-text contrast was at
least **5.049:1**. Keyboard traversal and actions, exact targets, disclosures,
project filtering, return scroll/filter/disclosure state, open/hidden Escape and overflow checks
passed. The browser, Vite server and esbuild service stopped, and the temporary
browser profile was removed. Main-agent visual inspection covered the desktop
dark and narrow light captures.

Evidence root: `C:/Users/nooro/AppData/Local/Temp/monocode-cc/cc7c/evidence/`.
`SCREENSHOTS.md` indexes every image and SHA-256; `browser-verification.json`
contains checks, isolation/cleanup receipts, viewport heights and source hashes.
`capture.ps1`, `capture.mjs` and `index.mjs` reproduce the capture. Standard
interaction checks use 1100 px viewport height; tall screenshot viewports show
both complete goals without changing the component's scrolling CSS.

## Proof limits and deliberate omissions

Screenshots establish the implemented React harness, not native WebKit,
production shell routing or a live provider session. No real profile data,
model turn, default startup preference, merge, push or deployment was performed.
The full attention queue, timeline and additional steering capabilities remain
with their assigned rounds. Global cost and historical goal completion time
remain unavailable until durable sources exist.
