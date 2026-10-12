# Direct project routing defaults off

New goals go through Grand Orchestrator unless the build explicitly sets
`VITE_MONO_DIRECT_PROJECT_ROUTING=true`. The flag is fail-closed: missing or
invalid values disable direct routing. With routing disabled, stale Manager
choices on the embedded, floating, and Mission command surfaces do not produce
new Manager ledger entries or deliveries, and the project selector and route
prediction are hidden. The goal input and submit action remain available.

Existing Manager receipts are checked before the new-goal flag and retain their
original owner and delivery recovery path. Fresh default-off submissions go to
Grand without reading retained-origin history. An origin without a receipt is
only checked and continued through its original route during explicit recovery.
The resolver and its acceptance cases remain intact.
Routing tests enable the flag in their fixtures so their original assertions
continue to describe the opt-in path.

Set the flag only in a development build when exercising the later routing
track. Release and preview builds must explicitly set
`VITE_MONO_DIRECT_PROJECT_ROUTING=false`. This change does not repair the
previously measured classifier defects; they remain deferred for that track.

## Validation

Source validation ran on tested source commit
`d9da820aef0cdc2b6036de5194a5be61b302a008` (tree
`45a3cafedb86c932ebebf35b80f2c8de153634c1`): focused Vitest passed 7 files /
649 tests; full Vitest passed 625 files with 2 skipped, 8,292 passed, 13
skipped, and 0 failed; `tsc --noEmit` and the production build both exited 0.
The production build explicitly set
`VITE_MONO_DIRECT_PROJECT_ROUTING=false` and used
`NODE_OPTIONS=--no-experimental-webstorage`.

The external actual-component fixture passed 48 matrix cases: default-off and
explicit opt-in each passed 12/12 in Chromium and 12/12 in WebKit across
MonoComposer, FloatingMonoChat, and MissionCommandBar. Missing and invalid flag
controls passed 1/1 in each browser (4 controls total). The 48 result JSON
records had the expected Grand/Manager delivery/ledger counters, and all 96
Chromium/WebKit screenshots were inspected. Browser flag variants were
separate static Vite builds. The stale Manager case replays a captured envelope
at the actual `submitMonoGoal` boundary; it does not simulate a runtime Vite
flag switch or a live UI toggle.

The browser harness uses synthetic transport. Native Tauri behavior, live
provider/model turns, and a product release preview were not exercised. Some
early shared-path raw logs and artifacts were overwritten; this loss is
documented in `C:/Users/nooro/AppData/Local/Temp/monocode-cc/cc5ro/evidence/ATTEMPT-RECOVERY.md`.
Later matrix attempts have unique directories and preserved raw output. The
original 8,291-pass/1-fail/13-skip full-suite failure on the older pin is
retained; its fixture-only opt-in correction passed 45/45, and the final frozen
source full suite passed with 0 failures. Detailed attempt logs and screenshots
are indexed in `C:/Users/nooro/AppData/Local/Temp/monocode-cc/cc5ro/REPORT.md`.

Evidence: `C:/Users/nooro/AppData/Local/Temp/monocode-cc/FINDINGS.md`,
`cc5ro/BRIEF.md`, the round report, and the focused routing tests under
`src/features/monos/model/monoGoalRouting*.test.ts`,
`src/features/monos/ui/{MonoComposer,FloatingMonoChat,MonoGoalRoute}.test.ts`,
and `src/features/commandCenter/ui/MissionCommandBar.test.ts`.
