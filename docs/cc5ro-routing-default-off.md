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

The checkout was source-only at implementation time and had no local Vitest
binary. Focused, full, type, build, and browser validation are listed in
`C:/Users/nooro/AppData/Local/Temp/monocode-cc/cc5ro/VALIDATION-READY.md` for
the separately assigned validation slot. No dependency install or broad gate
was started by this source-only round.

Evidence: `C:/Users/nooro/AppData/Local/Temp/monocode-cc/FINDINGS.md`,
`cc5ro/BRIEF.md`, and the focused routing tests under
`src/features/monos/model/monoGoalRouting*.test.ts`,
`src/features/monos/ui/{MonoComposer,FloatingMonoChat,MonoGoalRoute}.test.ts`,
and `src/features/commandCenter/ui/MissionCommandBar.test.ts`.
