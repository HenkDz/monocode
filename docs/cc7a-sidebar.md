# CC7A sidebar quick wins

The sidebar now leads with current work and keeps idle members and historical
work behind saved disclosures. This implements CC3's sidebar round, labelled
CC5A in its design document and CC7-A on the program board. The implementation
started from `nour` baseline `a6677f60325f98af4d139340da68a8746301bc99` on
`HenkDz/cc7a-sidebar`.

Managers show an expandable **N idle members** row. Selected, unread, focused,
attention, working, queued and blocked members remain visible, including when
the ordinary team disclosure is closed. The rail passes its existing Mono
unread counts through a small context; the existing App render callbacks keep
working. Member order follows the saved roster.

Worktree **History · N** defaults closed and pages five rows at a time. Primary,
dirty, unpushed, missing, selected or keyboard-focused checkouts, open sessions,
pinned/draft sessions, pending removals and work needing attention stay current.
Unfinished Manager work and accepted tasks with open or unknown PR state remain
current. Retained terminal checkouts with changes remain in the task section.
Opening History from active-only mode clears that filter so history is reachable.
The existing finished-worktrees preference now controls History; project and
task-group order are preserved. Individual worktree session disclosures also
persist, including when worktrees load after the component mounts.

Terminal task rows fold into their own History disclosure. Counts name their
population and lifecycle: **4 tasks · all cancelled**, or completed, cancelled
and unfinished totals. Completed work awaiting review stays current. Existing
`managerTaskFinished`, PR cache and CC4 selectors determine whether completed
project-manager work is actually finished. Historical summaries without known
acceptance remain visible as Waiting review. Expanded, focused and selected
worker details remain reachable; no task or checkout is deleted by folding.

Agent text uses CC4's `liveState`, `selectAgentLiveState` and `AgentStatusLabel`.
Reasons use `AgentDetailTooltip` and the row's `aria-describedby`, with a tooltip
on keyboard focus. Published canonical card states supply worktree/session
activity; a stale Idle card falls back to task context when review is outstanding.
The existing lifecycle indicators, task metrics and PR controls remain intact.
Changed labels have stronger secondary text in light mode. Narrow rails wrap
Manager/member names and status text using a sidebar container query.

Arrow Up/Down and Home/End move through marked native sidebar row buttons;
Arrow Left/Right operate disclosure rows. Hidden and disabled rows are skipped,
and ordinary Tab/Enter navigation remains available. The focused resize separator
supports Left/Right in 10-pixel steps, Shift in 40-pixel steps, Home/End for
bounds and Enter for the default. Width persists through the existing preference.
Narrow windows retain a valid 180-pixel minimum. A one-line `useDragResize`
accessor exposes its existing commit function so keyboard and subsequent pointer
resize share the same width, clamp and persistence behavior. No other resize
caller changes.

Validation used Windows, Node 26.5.0 and
`NODE_OPTIONS=--no-experimental-webstorage`:

| Check | Final result |
| --- | --- |
| Full Vitest, `npx vitest run --maxWorkers=4` | 565 files: 563 passed, 2 skipped, 0 failed; 6,316 tests passed, 13 skipped, 0 failed, 0 todo; 6,329 total |
| Focused sidebar regressions, seven files | 183 passed, 0 skipped, 0 failed: 85 team/connected, 85 worktree, 13 rail/project-group |
| Previously timing-sensitive remote/CRLF pair | 33 passed, 0 failed with two workers and no source changes |
| `npx tsc --noEmit` | Passed |
| `npm run build` | Passed |
| `git diff --check` | Passed |
| Isolated component browser acceptance | 113 checks passed, 0 failed; 10 screenshots; source hashes stable; helpers stopped |

The first full run recorded 6,307 passed, seven failed and 13 skipped. Two
connected assertions expected the old agent/done counts; five unrelated remote
or CRLF tests failed under parallel timing pressure and passed in isolation.
The final full run used four workers without filtering, timeout changes or new
skips. Initial TypeScript/build checks caught two test-only uses of `Array.at`;
those use indexing compatible with the existing target. An intermediate
PowerShell logging helper treated build warnings as errors; its final receipt
records the actual zero exit codes. Original failures remain in the evidence.

Evidence is under
`C:/Users/nooro/AppData/Local/Temp/monocode-cc/cc7a/evidence/`:
`vitest.json`, `vitest.log`, `vitest-receipt.json`, `typescript.log`, `build.log`,
`build-summary.json`, focused logs/JSON/receipts, `first-run/`,
`vitest-first-run.*`, `browser-verification.json`, `SCREENSHOTS.md`,
`capture.mjs` and `harness/`. The screenshot index includes dark, light and
390-pixel layouts, expanded history, a storage-held Reviewer, seven idle
members, four cancelled tasks and 72 historical worktrees. The changed labels'
sampled contrast is at least 4.70:1 in light mode and 6.22:1 in dark mode.

The preview renders the real four components in a Chromium harness with
synthetic IPC, roster and orchestration data. It launches from an empty isolated
folder with a separate app identifier/home and no CODEX_HOME or ORCA variables.
Browser/server shutdown is recorded. Reduced motion is enabled; the supplementary
200% image uses CSS zoom. Native desktop/provider acceptance, a full screen-reader
or browser text-zoom audit, and Cargo checks were not performed. Native files,
dependencies, App.tsx, the session/right-panel round and the orchestration engine
are unchanged. The only supporting edits outside the four UI files are their
connected tests and the one-line resize accessor. No merge, push, deployment,
real profile mutation or live model turn was performed.
