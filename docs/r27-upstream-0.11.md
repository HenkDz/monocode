# R27: upstream MonoCode v0.11.0

Branch: `HenkDz/r27-upstream-0-11`.

Merge commit: `e5e34663e245174a06d00af77326a735cc56caa6`, message
`Merge upstream MonoCode v0.11.0 and preserve org behavior`.
Its two parents are the starting `nour` head
`f68170ba86bb2e515226e9017e36ee82443c1c91` and upstream v0.11.0
`1ef5357ae71d6fd5bd9833a6fe3cedd096b7ef93`. The tag was fetched directly
from `https://github.com/hardbeat920/monocode.git`; `origin` remains
`https://github.com/HenkDz/monocode.git`. This is a real merge, with no
rebase or squash. Nothing was pushed, no PR was opened, and neither
`nour` nor `main` was merged into or moved by this round.

## Conflicts and integration decisions

All ten conflicted files were resolved by combining the two sides:

| Conflicted file | Resolution |
| --- | --- |
| `src/app/App.tsx` | Kept org artifacts, role-aware activity/details, teams, PR navigation, storage/authorization wiring, and the recent worktree fixes. Added upstream Mono changes/commit panels, checkpoint finish/cancel flow, Devin support, folder preferences, and `sidebarCwd`/`newWorkspaceSession` for #896. Closing the fork's panel or opening org activity now also clears the changes panel. |
| `src/app/hooks/useFloatingMono.test.ts` | Retained fork descendant/run-decision coverage and upstream roster-status coverage. Removed the status-only mock override, which discarded the real fork activity state; assertions remain intact. |
| `src/features/connections/model/remoteCommands.test.ts` | Combined fork `gitFetch` imports with upstream selected-file commit/location/context imports; retained both sets of tests. |
| `src/features/monos/model/floatingMono.ts` | Combined fork org roles and forwarded live state with upstream session-derived roster status. Added a focused regression for role/status coexistence and forwarded org activity. |
| `src/features/monos/ui/MonoDetails.tsx` | Retained org Details/Activity/PR tabs, teams, archive/storage controls and immediate permission editing. Added upstream settings/preferences routes and moved conversation reset into preferences. |
| `src/features/monos/ui/MonoSettingsPage.tsx` | Kept org field locks, team-size controls and team navigation; combined upstream Settings navigation and reset relocation. |
| `src/features/monos/ui/MonoSidebar.tsx` | Kept fork PR panels, children and viewport sizing; combined upstream changes readers and rich headings. |
| `src/features/monos/ui/monoPanelParts.tsx` | Kept org field validation/locks; added upstream switch sound cues. |
| `src/features/source-control/ui/GitChangesPanel.tsx` | Kept the shared fork PR gateway/cache hook instead of adding upstream's separate polling implementation. Took upstream editable commit messages and exported sync actions. |
| `src-tauri/src/mono_chat.rs` | Kept org roles alongside upstream rail status and status-aware roster/menu updates; extended the existing serialization regression. This file is macOS-gated, so its runtime test was not executed on Windows. |

Two callers needed small adaptations: `MonoTeamPage.tsx` now routes member
Settings to `MonoPreferencesPage`, with navigation regressions in
`MonoDetails.test.tsx`; `MonoProjectCommit.tsx` imports the existing shared PR
hook directly. The auto-merged `Sidebar.tsx` retains Tree/project ordering and
adds upstream pinned Mono rail controls. `ProjectWorktrees.tsx` and
`worktreeSessions.ts` remain byte-for-byte equivalent to the fork baseline;
the App clauses for closed unsent sessions and deleted-worktree navigation
also survive. The GitHub gateways and Codex Mono storage implementation were
preserved. Upstream Windows normalization, checkpoint path comparisons,
selected-file validation and Git-backed turn reviews remain present.

No requested fork feature was dropped. Where behavior differs, the fork's
immediate permission controls remain available while a Mono is busy rather
than adopting upstream's busy-only explanatory hint. Upstream PR polling is
implemented through the fork's budget/cache/stale-data hook. Preferences and
reset moved to the upstream settings route without removing the fork's org
controls. Version metadata and release notes are 0.11.0 as upstream supplied.

The required Rust checks also exposed baseline formatting in eight files:
`app_cli_inputs.rs`, `control.rs`, `control_cli.rs`, `fs.rs`, `lib.rs`,
`mono_transcript.rs`, `session_store.rs`, and `worktrees.rs`. These were
formatted. Three baseline Clippy findings were reconciled: a nested empty
GitHub-output guard, an unnecessary borrow, and a targeted
`too_many_arguments` allowance preserving the public Tauri command's flat
IPC signature. No authorization or validation was removed.

## Verification

Verification was delegated to three subagents. Local evidence is under
`target/r27-verification/` (ignored, retained for coordinator inspection).
Node 26 runs used `NODE_OPTIONS=--no-experimental-webstorage`.

| Check | Final result | Evidence |
| --- | --- | --- |
| `npm ci` | Exit 0; 425 packages added, 426 audited. Reported 9 advisories (5 low, 1 moderate, 1 high, 2 critical); applicability not investigated, no audit mutation. | `npm-ci.log` |
| `npx tsc --noEmit` | Exit 0. | `tsc.log` |
| Full `npx vitest run --maxWorkers 1` | Exit 0; 541 files passed, 2 skipped; 5,829 tests passed, 13 skipped. | `vitest-serial.log` |
| `npm run test:host -- --maxWorkers 1` | Exit 0, including host build; 23 files passed, 1 skipped; 142 tests passed, 14 skipped. | `host-final.log`, `host-final.exit` |
| `npm run check:rust` | Exit 0; fmt and Clippy (`--workspace --all-targets -- -D warnings`) passed; 615 Rust tests passed, 1 ignored, 0 failed. | `check-rust.log`, `check-rust.exit` |
| `npm run build` | Exit 0; production frontend built. Existing CSS/minifier and large-chunk warnings remain. | `frontend-build.log` |
| Isolated native debug preview build | Exit 0; final native fixes and production frontend included. | `preview-build.log`, `preview-alignment.json` |
| Diff/source review | No unresolved conflicts or whitespace errors; independent App semantic review found no merge defect. | Merge tree `70e4ef9928d901622b5307d2db3a1542245a061e` |

Earlier frontend runs exposed the PR-hook caller mismatch and the floating
Mono mock issue, both fixed above. Real-Git editor/navigation timeouts under
concurrent builds produced cascading cleanup failures. Final suites ran
serially after native compilation, without changing assertions or timers.
The host Claude reasoning fixture could select a background title-generation
command; it now selects the actual turn by its model and permission-prompt
flags while retaining the `low`/`high` effort assertions. The final host
worktree rename/cleanup tests passed with their original waits. PowerShell 5
misclassified redirected compiler stderr; the native runner used PowerShell
7. No tests were weakened or deleted.

## Accepted live check

Only the final fresh run is acceptance evidence. It launched from the empty
folder `C:/Users/nooro/AppData/Local/Temp/monocode-r27-live-f48ecdf122/empty-cwd`
with identifier `com.monocode.desktop.r27-upstream-0-11-test`. Its executable
was a hash-identical copy named `r27-isolated-preview.exe`; SHA256:
`6D0945B50C4B74A5229FE92C665E5A8FE45342391834C6E40A7666BF2B19779A`.
The copied binary contains the final source changes; no production source
changed after its build. Native PID 56988 and WebView PID 142992 were proved
to be parent/child; CDP port 9463 belonged to that WebView and its user-data
folder was inside the fresh sandbox.

`CODEX_HOME`, every `ORCA_*` variable and every `MONOCODE_*` variable were
absent. Profile, app data, WebView data, npm prefix/cache/config and temporary
paths were isolated. Effective npm prefix/cache were checked before launch;
inherited provider PATH entries were removed. Runtime version was 0.11.0,
product `home_dir` and app-data paths resolved inside the sandbox, and the
initial native workspace snapshot was null. The generic Tauri OS `homeDir`
API still reports the real Windows home; it was not used to seed fixtures.

Disposable Git projects A/B and a B worktree were created, and completed
history was seeded only in the sandbox. The agent used actual React UI
clicks in the running native WebView, with screenshots and read-only current
React state inspection:

| Required behavior | Observed result |
| --- | --- |
| App starts on 0.11.0 | Native runtime version 0.11.0; fresh app/profile boundary verified. |
| New session opens in the right project | Opened Fixture A, selected B (which opened a blank B chat), then clicked plus. New session `06adb9f0-7133-4ab9-9ea8-a2f41b48f4f9` had B as `cwd` and its tab was focused. |
| Tree shows worktrees and sessions | B's `r27-task` worktree listed both seeded sessions. Selecting Fixture Tree One opened B with `worktreeCwd` equal to the disposable `project-b-task` checkout. |
| Worktree row toggles sessions | Listed rows changed 2 → 0 → 2 when clicking the worktree row; active tab remained unchanged. |

Evidence: `live-results.json`, `live-unique-initial.json`,
`preview-launch-unique.json`, `live-process-proof.json`,
`live-final-native-isolation.json`, and screenshots
`live-project-a-active.png`, `live-project-b-before-new.png`,
`live-project-b-new-session.png`, `live-tree-expanded.png`,
`live-tree-collapsed.png`, `live-tree-session-open.png`. Native persisted
snapshots lagged live focus, so they were used for sandbox boundary checks;
current UI state supplied session-focus evidence. No provider prompts or
forge writes were sent. The preview was stopped; `live-preview-stopped.json`
confirms PID 56988 is absent.
The stopped sandbox database was inspected read-only: all session and
snapshot roots were inside the sandbox, and every provider session ID was
absent.

The exact #896 state with A still active while B is selected was not
reproduced live: normal project switching selected a B chat first. The live
check proves the actual switch/plus workflow; the more specific stale-default
case is covered by the upstream helper tests and App source review.

## Earlier preview incidents and remaining limits

Earlier runs are excluded from acceptance and preserved under
`live-prior-attempts/` plus `native-isolation-audit.json`. A first-run npm log
confirms `npm install --global @openai/codex` attempted retirement of the real
NVM Codex installation and failed with `EBUSY` copying the in-use executable.
The triggering action is unknown: the agent's recorded history contains no
update click, and source inspection makes installation button-driven. It
must not be described as a proven automatic startup update.

A subsequent run had an unrelated real project/session persisted inside its
sandbox DB. Native review found no cross-instance snapshot/store fallback or
global window-transfer route. External automation selecting the common
`monocode` executable name is a hypothesis, not an established cause. Both
runs were stopped. The final run used a fresh profile, unique executable
basename and unused CDP port; all observed project/session roots remained
inside its sandbox. Stale/cross-window Orca UIA output was excluded; accepted
evidence came from the verified native WebView.

The original global Codex package (reported version 0.162.0), executable and
shims still exist with pre-attempt file modification times. A hidden
retirement sibling also exists with older executable metadata. There is no
prelaunch hash baseline or rollback proof, so partial effects of that failed
installation cannot be certified absent, and the sibling's creation cannot
be attributed confidently. No repair or deletion was performed. A bounded
audit found no installed MonoCode/production-profile mutation evidence;
there is no complete pre/post comparison of those real directories.

Not verified: macOS/Linux runtime behavior, the macOS-only roster
serialization execution, live Devin/other provider authentication or
execution, real-forge PR workflows, signed release packaging, and dependency
advisory remediation. The ignored Rust test needs its loopback SSH fixture;
existing frontend/host skips remain. No deployment or promotion occurred.
