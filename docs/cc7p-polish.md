# CC7P: Command Center visual consistency

The sidebar, Mission control and member work view now use the same canonical
state colors and cues. This round started from `nour` commit
`e950866bb164ded1eba3cbcd5632279a8fd313c8` in the existing
`HenkDz/cc7p-polish` worktree. It implements the coordinator's five polish notes
against the CC3 mockups and the merged CC7A/B/C components.

`AgentStatusLabel` keeps the existing readable labels and reason tooltips and
adds a decorative dot, or a green check for Done. `agents/ui/agentState.css`
defines a token for every CC4 state in both themes: amber for Blocked/Needs you,
blue for Thinking/Compacting, green for Running tool/Done, muted for waits,
Queued/Idle, and red for Failed. Task borders use those same tokens; lifecycle
and verified PR outcomes remain separately labelled. The shared stylesheet
suppresses an older MonoStatus wrapper's extra dot and removes whole-row
opacity from Mono rail rows that contain a canonical label. Neither requires
an edit to unrelated sidebar behavior.

The coordinator's upstream note is
`C:/Users/nooro/AppData/Local/Temp/monocode-cc/upstream-2026-10-11.md`.
Upcoming launched-session cards can consume the exported, plain
`AgentStatusLabelProps`: required `state: AgentLiveState`, optional
`className: string`. The component does not read sessions, providers, stores or
orchestration data. For example:

```tsx
<AgentStatusLabel state={cc4State} className="text-xs" />
```

The integration round should supply CC4's canonical state instead of maintaining
upstream's separate `launchedSessionState()` model or treating an unopened
session as Done. Color tokens and the dot/check travel with this component.
Launched-session cards, artifact chips and the older Show sessions footer were
deliberately left to upstream integration.

Mission nodes use one tabular metrics line. Its native disclosure retains the
observed-turn or attempt timing scope, goal contribution, and separate engine
and member-chat contributions. Shared-conversation accounting appears once per
goal. The selectors, input/cache conventions and overlapping goal totals are
unchanged. Unknown counters say **Tokens unavailable** and unknown node time
says **Elapsed unavailable**, consistent with the member view; they never
become zero. Node cards use 12px padding, 8px radius and the same subtle border
as member task cards. Attention borders use the shared amber token.

An idle Manager waiting on a blocked or failed current goal member now says
**Waiting · Reviewer blocked** or **Waiting · Reviewer failed**. CC4's selector
owns the behavior through optional current `members` context. Mission control
supplies only unaccepted, unfinished assignments from live goals and nonterminal
runs. Its own busy turn, queue, question and blockers still take precedence.
Completed/cancelled work, reused worker sessions and terminal goals cannot add
an old dependency blocker. Failed tasks display their saved failure rather than
a later reused session's state.

The member header uses the canonical cue directly. Repeated header/row metrics
omit an already-visible state while retaining it in the tooltip. The delivery
explanation appears once beside the composer. Assignments and history have a
labelled, focusable scroll region with a reserved thin scrollbar gutter, bottom
padding, separator and visible keyboard focus; queue actions remain reachable
below the initially visible portion. Recovery, queue editing/removal, task
cancellation, tab navigation, draft retention and task readers keep their
existing handlers. Selected secondary text has stronger contrast.
Read-only agent tooltips now let pointer events pass through their Popover frame
as well as their content. The bounded member browser check exposed the frame
covering History after a task reader closed; the shared tooltip fix preserves
focus/Escape descriptions while keeping the covered controls clickable.

Alternatives rejected: a second state selector in the view, generic roll-up of
all historical failed tasks, lifecycle colors masquerading as provider state,
new metric/cost calculation, removing details to shrink cards, and changing
orchestration, routing or storage. The generic historical-task roll-up was
removed after independent review showed that aggregate roster callers include
tasks from finished runs. No new dependencies, native changes or global style
rewrite were needed.

## Validation and evidence

Windows / Node 26.5.0 checks use
`NODE_OPTIONS=--no-experimental-webstorage`. The four-worker cap runs the full
Vitest suite without filtering or adding skips.

| Check | Final result |
| --- | --- |
| Full Vitest | 570 files: 568 passed, 2 skipped, 0 failed. 6,455 tests passed, 13 skipped, 0 failed; 6,468 total. |
| Focused state/UI/projection checks | 114 passed, 0 failed/skipped in seven files. |
| Connected member messaging check | 19 passed, 0 failed/skipped in one file. |
| `npx tsc --noEmit` | Passed, exit 0. |
| `npm run build` | Passed, exit 0. |
| `npm run test:browser` | 82 tests: 81 passed, 1 failed, 0 skipped/flaky. Chromium 41/41; WebKit 40/41. |
| Focused member/history browser regressions | 8 passed, 0 failed/skipped/flaky across both engines. |
| Isolated visual acceptance | 228 checks passed, 0 failed; 38 final screenshots (12 before, 26 after). |

The only final browser failure is the unchanged Windows WebKit Blob-MP4 test
`video-preview.spec.ts:3`: metadata readiness is false and media error is 4.
It was neither weakened nor skipped. The first working full-browser attempt had
77 passes and five failures: the tooltip/history interaction in both engines,
the old worktree-history expectation in both engines, and this video failure.
All four relevant regressions pass after the fixes. An earlier isolated launch
could not find the installed browsers because LOCALAPPDATA had moved to the
synthetic home; its 82 launch failures are retained as setup failures. The final
run reads the existing installed browser cache through PLAYWRIGHT_BROWSERS_PATH
while retaining the isolated home, launch folder and browser profiles.

Final Vitest took 115.67 seconds; TypeScript 26.71 seconds; the build 68.558
seconds, with 39.97 seconds in Vite and 3,679 modules. Existing warnings remain:
two transcript `::highlight` CSS selectors, mixed dynamic/static `mono.ts`
imports, and the large-chunk advisory. Native and dependency files are unchanged.

The existing two real-provider Antigravity suites account for the 13 skipped
tests. Initial full-suite results were 6,453 passed, 13 skipped and two failed:
connected member tests still expected the old header attribute and delivery
warning in the queue. Their assertions now require the canonical header and a
single note in the composer. Original logs and JSON are retained; the final
full-suite totals are not combined with focused or intermediate runs.
The existing worktree-deletion browser check now opens the History disclosure
before opening its clean inactive worktree, matching CC7A's saved grouping. Its
nonmodal deletion, other-worktree interaction and branch-disable checks remain.

Evidence root:
`C:/Users/nooro/AppData/Local/Temp/monocode-cc/cc7p/evidence/`.
`validation/summary-final2.json` records commands, environment, timings and source
hashes; `vitest-full-final2.*`, `typescript-final2.log`, `build-final2.log` and
focused logs contain raw proof. `review-and-first-focus.md` records independent
review findings and the earlier incorrectly quoted environment invocation.
`visual-summary.json`, `SCREENSHOTS.md`, `before/`, `after/`, and the capture
scripts contain the synthetic harness proof and source/screenshot hashes.
The final BEFORE images use an evidence-only Vite source override loaded from
the exact starting commit, with raw bytes and hashes under
`before/head-overrides/` and `before/head-overrides.json`. Four baseline Mission
checks assert that the first Manager says Idle. The earlier BEFORE attempt had
included an intermediate selector edit; it is preserved separately under
`probe-before-selector-dirty/` and is not used for the comparison totals.
`validation/results-final2.json`, `browser-full-final2.log` and its trace folder
retain all browser results. `final-commit-binding.json` binds the validated and
captured source bytes to the committed branch tip.

Browser screenshots exercise the existing CC7A sidebar, CC7B member and CC7C
Mission fixtures. Dark/light wide and narrow comparisons, metrics disclosures,
keyboard-scrolled queue cards and complete two-goal chains remain inspectable.
The final matrix also contains dark/light 700x400 checks that open a task reader,
close it with Escape, then click History through the restored tooltip area.
The canonical palette includes all eleven states on six backgrounds, including
older Mono rail wrappers, in both themes. Its 132 contrast samples have a minimum
of **6.81:1 dark** and **5.75:1 light**; two additional legacy-wrapper samples
check that only one cue is visible. Sampled actual-surface text is at least
4.5:1. This is targeted browser/contrast evidence, not a complete WCAG audit.

Previews use isolated empty launch folders, synthetic homes/browser profiles and
separate identifiers, with CODEX_HOME and every ORCA variable removed. Preview
processes are stopped. Some synthetic Chromium scratch-profile files resist
deletion with Windows EPERM; shutdown receipts identify retained paths rather
than claiming deletion. No real profile/database or live provider turn was used.

Native/provider acceptance, a full screen-reader audit, new attention/steering
features, merge, push and deployment remain outside this round. Native and host
files are unchanged, so Cargo checks were not required. The coordinator owns
integration and live shell acceptance.
