# CC7E: delegation timeline per goal

Branch: `HenkDz/cc7e-timeline`, starting from
`e950866bb164ded1eba3cbcd5632279a8fd313c8`. Implementation commit:
`930fe16f7a767297a1cca49590c2722b52e29223`.

Mission control's **View timeline** link opens the selected goal's recorded
delegation history. Grand Orch and Manager lanes show attributed turns; each
worker dispatch has its own lane, preserving implementation retries and both
reviews in a review → fix → review loop. Review labels identify the exact
implementation task and dispatch. Conversation links use the saved attempt
session, including retained historical workers.

The chart uses a common wall-clock axis and an always-available interval ledger.
Every span or milestone links to its ledger row. The ledger supplies actor,
attempt, assignment, start, end, duration and evidence, using table captions and
row/column headers. Short bars and point observations have external text labels;
unknown timing is hatched or labelled. Dedicated chart/table regions scroll on
narrow screens without making the page overflow. No chart durations are summed
into a wall-time total.

## Recorded data and honest gaps

The projection reuses `selectGoalViews` for the goal/roster/review joins and
`selectDelegationEdges` for durable dispatch identities and timestamps. It reads
CC4 user-turn boundaries, optional dispatch snapshots and compaction receipts.
There is no provider event parsing, persistence change or second timing capture
layer.

Dispatch acceptance to a recorded turn start is labelled **Awaiting turn start**.
Observed first content is a separate milestone, never the start of a model call.
Recorded settlement and report delivery have separate milestones; their interval
is **Report delivery**. A Manager's **Review outstanding** interval describes the
assignment until report/settlement and can overlap the Manager's own work.
Provider turn end/duration takes precedence over later app settlement, retaining
the same boundaries when the worker transcript is unloaded.

CC4 does not record exact model/tool phases or historical blocker start times.
Turn spans therefore say **phases unknown**. Current blockers and actor state
are point snapshots with an unknown onset and duration. A queued review can
show known time awaiting a recorded turn start without claiming when its storage
blocker began. Restored `start_unknown` and `stop_unknown` attempts do not imply
an ongoing queue or execution. One-sided compactions keep their missing boundary
unknown. Blank chart space has no recorded coverage. A finished goal shows a
recorded window, not a completion time inferred from `updatedAt`.

Stable turn/dispatch identities deduplicate repeated records. Partial duplicate
dispatch receipts merge known immutable boundaries independently of array order;
conflicting boundaries remain unknown and are explicitly labelled. Compaction
receipts join independently observed starts/ends and reject conflicting/reversed
ranges. Invalid Date epochs and overflowing derived ends are ignored rather
than crashing the caption. Inactive interrupted turns never extend into a retry,
and unrelated turns in shared conversations stay outside the goal.

## Minimal integration

The marked CC7E integration is exactly one link line in
`ui/MissionControl.tsx` plus the import adapter in `src/app/App.tsx`.
`DelegationTimelineRoute` owns the local goal route and reuses Mission control's
existing full-view/back/session navigation lifecycle. Mission control stays
mounted with its filters, Finished disclosure and scroll position intact.
Returning focuses the invoking link. Timeline Escape is claimed in capture so
the shell cannot stop a hidden busy conversation; the missing-goal fallback
also guards Escape and focuses Back. Hidden routes release their key handler and
stop the elapsed timer.

`GoalChain.tsx`, the agent UI, Sidebar and all native/host/provider files are
unchanged. No dependency or project configuration changed. Alternatives
rejected: reconstructing phases from tool text, silence, model-call counts or
baseline medians; deriving blocker/completion starts from mutable updates;
adding provider telemetry in this round; summing concurrent lanes; introducing
another shell-wide route/state or execution path.

## Validation

Final Windows / Node 26.5.0 checks use
`NODE_OPTIONS=--no-experimental-webstorage` and the installed lockfile.
The worker cap bounds concurrency; the full suite is unfiltered.

| Check | Result |
| --- | --- |
| Full Vitest (`npx vitest run --maxWorkers=4`) | 570 files passed, 2 skipped, 0 failed; 6,454 tests passed, 13 skipped, 0 failed, 0 todo; 572 files / 6,467 tests total |
| CC7E tests, included in that full suite | 27 passed, 0 skipped, 0 failed: 20 model and 7 UI/route tests |
| `npx tsc --noEmit` | Passed, exit 0 |
| `npm run build` | Passed, exit 0 |
| Working/staged `git diff --check` | Passed |
| Native tests | Not required: no native changes |

The two existing Antigravity provider suites account for all 13 skipped tests;
CC7E adds no skips. Vitest's JSON suite count includes nested describe groups,
and its raw file statuses label skipped files passed, so the evidence reconciles
file counts with assertions and the terminal reporter. Focused results are not
added to the full-suite totals.

Final wrapper durations: Vitest 111.34 seconds, TypeScript 21.84 seconds and build
42.40 seconds. All source hashes stayed unchanged across each command and the
full sequence. The implementation commit changes metadata only relative to the
tested frozen source. Earlier runs during corrections are retained as
provisional evidence, not final-source proof. Existing build warnings include
two CSS `::highlight` optimizer warnings, the `mono.ts` dynamic/static import
advisory and large chunks; test logs retain Shiki/React warnings.

The real React harness passed **158 browser checks, 0 failed**, producing
**12 screenshots**: compaction with a queued review, two reviews around a fix,
concurrent workers and restored unknown intervals in both themes; dark/light
ledger captures; and dark/light 390px captures. Checks cover keyboard operation,
span/ledger identity, exact conversation target, review references, unknown
timing, dedicated scrolling, readable labels and contrast. Minimum sampled text
contrast was **5.897:1**. Capture hashes matched the frozen source. Browser,
Vite, conhost and esbuild stopped; the isolated browser profile was removed and
no owned preview processes remained. Main-agent visual inspection covered the
dark compaction chart, light ledger and narrow light unknown-history view.

## Evidence and proof limits

Evidence root: `C:/Users/nooro/AppData/Local/Temp/monocode-cc/cc7e/evidence/`.
`browser-verification.json` contains checks, source hashes and cleanup;
`SCREENSHOTS.md` indexes every image and SHA-256. `capture.ps1`, `capture.mjs`
and `processes.ps1` reproduce the isolated browser run. The harness and its four
CC4 fixtures are committed under `src/features/commandCenter/fixtures/timeline/`.

`validation/final/` contains the full Vitest JSON, assertion-reconciled counts,
raw logs, command receipts and before/after source snapshots. The reproducible
runner is `validation/run-validation.mjs`; `validation/initial/` and
`pre-final/` preserve provisional checks/captures.

This proves the projection, React component and synthetic route behavior, not
native WebKit, production shell routing or live provider sessions. No model turn,
real profile/database change, merge, rebase, push or deployment was performed.
Exact model/tool intervals and historical blocked spans remain unavailable until
durable capture supplies them; extending that capture belongs outside CC7E.
