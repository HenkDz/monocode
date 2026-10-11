# R28: upstream MonoCode v0.12.0

Branch: `HenkDz/r28-upstream-0-12`.

Merge commit: `ac01ce355a1148ca9d44e92fdefa0aa0c3224688`, message
`Merge upstream MonoCode v0.12.0 and preserve org behavior`.
Its two parents are starting fork head
`a20ff99ea69485a0cc543481b797b61117ec084b` and pinned upstream main
`efecfc9541812271d8047946745b4962581c8c6d`. Its tree is
`f5569fb516a7cb38514f9363739375dffb866876`, identical to the verified native
build/live source tree. This record is a separate documentation commit,
following R27's shape.

Fetched with the brief's direct upstream URL and tags. The fetched main tip
was exactly `efecfc9`, so no newer tip was merged. This brings in all 28
commits after v0.11.0, including v0.12.0 and the six later fixes, through one
real merge commit. There was no rebase or squash. `origin` remains
`https://github.com/HenkDz/monocode.git`.

Nothing was pushed, no PR was opened, and neither `nour` nor `main` was merged
into or moved. Their heads remain `a20ff99ea69485a0cc543481b797b61117ec084b`
and `610550e4ddde1ee22a66a28eb88fb08e3ac5cd09`, respectively. No branches or
worktrees were deleted, no stash was used, and no global installation or
toolchain update was performed.

## Conflicts and integration decisions

All nine conflicted files were resolved by reading both sides' changes and
combining their intent:

| Conflicted file | Resolution |
| --- | --- |
| `CONTRIBUTING.md` | Adopted upstream's focused provider/build guides while retaining the fork's separate-identifier/empty-folder preview rule. Updated its link to the relocated instructions. |
| `README.md` | Adopted upstream's documentation restructure and contribution text. Moved the fork's complete isolated-preview instructions and platform launch examples into `docs/building.md`, with links from README and CONTRIBUTING. Platform/package/provider material remains in upstream's new guides. |
| `src/app/App.tsx` | Kept Managers, org/team/artifact/PR/Inbox/storage wiring, manager watchers and worker retention, closed-unsent filtering, deleted-worktree navigation, and org selection. Combined upstream Mono-launched inline session panes, focus/foreground handling and quick-launch `openTab`, unread reply counts, stable sidebar summaries, idle-agent policy and edited-path checkpoint recovery. Retained org/team live-state aggregation and safe selection handling across global surfaces. |
| `src/app/shell/MonoRailSection.tsx` | Kept fork availability and descendant-working labels, including safe generic accessible status text, while adding upstream counted unread badges and reply labels. Added a regression for team activity and unread counts appearing together. |
| `src/features/monos/model/monoFiles.ts` | Kept all fork org, authorization, artifact and storage instructions and added upstream reaction rules. Advanced the fork's prompt cache version from 23 to 24 so existing chats receive the new instructions; upstream's version 18 would regress that cache. |
| `src/features/sessions/model/session.ts` | Retained `monoCardOwner` and team-change receipt fields alongside upstream tool edit paths and reaction metadata. |
| `src/features/sessions/ui/AgentTranscript.tsx` | Kept org turn accessories, manager actions, receipts/cards and existing rendering behavior while integrating streamed word fades, input-aware scroll following, reactions and edit-turn actions. Regression coverage proves historical org output and the upstream changes action coexist. |
| `src/features/sessions/ui/SessionPane.tsx` | Kept member work logs, manager-owned notices and historical PR accessories alongside upstream compact Mono edit-turn controls and recovery paths. Ordinary sessions retain full review; Mono changes actions now follow upstream's edit-turn placement. |
| `src/features/sessions/ui/SessionPaneScroll.test.ts` | Combined fork orchestration/scroll probes with upstream changes-control probes. Retained existing assertions and added coverage that member work logs and Mono edit controls coexist. |

One auto-merged upstream behavior required an integration fix:
`monoReactionBlocks` originally discarded everything after the reacted user
except notices. It now also retains durable org cards, team-change receipts
and artifacts, including payloads attached to the reaction block itself or
a partially streamed reply. It keeps cached immutable render copies and
does not rewrite persisted history. Focused unit and real transcript-render
regressions cover those payloads. The prompt-version regression was also
updated without removing fork instruction assertions.

No requested fork feature was dropped, and no contradictory fork/upstream
test required deleting or weakening an assertion. The review placement and
unread-count behavior follow upstream; reaction rendering was extended to
preserve the fork's durable output.

`ProjectWorktrees.tsx` and `worktreeSessions.ts` are unchanged from the fork
baseline. This preserves `15f8aeb` provider selection, `4661a0e` deleted-tree
grouping, `74325b0` orphaned-row navigation and `f68170b` row toggling; App
also retains `3f420be` closed-unsent filtering. Mono-launched sessions with
real user/draft blocks survive that filtering and receive the upstream
inline Sessions panel and open-in-workspace route. The host, orchestration,
Inbox, source-control, dedicated PR view, Team map, GitHub gateway/API budget,
Codex Mono storage and R27 org UI implementations remain intact. Auto-merged
sidebar changes add counted compact badges while retaining Tree/project
ordering. Native command registrations, path validation and R27 fixes remain
present alongside upstream reveal-path, new-window and single-instance fixes.

Version metadata in package/Cargo/Tauri configuration, lockfiles and CHANGELOG
matches upstream 0.12.0. Fork-specific Windows security feature flags remain.
Independent source-review notes are retained in `app-integration.md` and
`session-integration.md` under the evidence directory below.

## Verification

Checks, browser diagnostics and native/UI verification were delegated to
subagents. Complete local logs, receipts, scripts and screenshots remain in
ignored `target/r28-verification/` for coordinator inspection. Heavy checks
ran sequentially. Node 26.5.0 used process-local
`NODE_OPTIONS=--no-experimental-webstorage`; Rust/native output stayed in
this physical worktree's own target directory.

| Check | Final result | Evidence under `target/r28-verification/` |
| --- | --- | --- |
| `npm ci` | Exit 0; 425 packages added, 426 audited. Reported 9 advisories: 5 low, 1 moderate, 1 high, 2 critical. No audit mutation. | `npm-ci.log`, `npm-ci.receipt.json` |
| `npx tsc --noEmit` | Exit 0; no diagnostics. | `tsc.log`, `tsc.receipt.json` |
| Full `npx vitest run --maxWorkers 1` | Exit 0; 545 files passed, 2 skipped; 5,920 tests passed, 13 skipped. | `vitest.log`, `vitest.receipt.json` |
| `npm run test:host -- --maxWorkers 1` | Exit 0, including host build; 23 files passed, 1 skipped; 142 tests passed, 14 skipped. | `host.log`, `host.receipt.json` |
| `npm run check:rust` | Exit 0; fmt and workspace/all-targets Clippy with warnings denied passed; 629 tests passed, 1 ignored, 0 failed. | `rust.log`, `rust.receipt.json` |
| `npm run build` | Exit 0; production frontend built. Existing CSS/minifier and large-chunk warnings remain. | `frontend-build.log`, `frontend-build.receipt.json` |
| Full `npm run test:browser` | Exit 1; 27 passed, 1 failed: all 14 Chromium cases and 13 WebKit cases passed. Remaining Windows WebKit Blob-MP4 limitation is detailed below. | `browser-final-2.log`, `browser-final-2.receipt.json` |
| Isolated native debug preview build | Exit 0; production frontend embedded, separate identifier/product name, no bundle/installer. | `preview-build.log`, `preview-build.receipt.json`, `tauri.preview.conf.json` |
| Required native live check | 4/4 passed; preview stopped and sandbox audited. | `live-check.md`, `live-results.json`, `live-preview-stopped.json`, `live-sandbox-store-audit.json` |
| Source/diff review | No unresolved conflicts or whitespace errors. Merge tree matches build and live verification. | `source-alignment-before-build.json`, `source-alignment-after-build.json`, `source-alignment-after-live.json` |

Browser checks exposed fixture API readiness races and a driver racing the
legitimate 120 ms fade cleanup. Two test-only paths were corrected:
`title-tab-reorder.tsx` registers its API before paint, and
`tab-revisit.spec.ts` waits for its API and full streamed text before pausing
the first regression's JS cleanup timers. It then advances three 16 ms
frames for the original post-show check. Streaming and the second regression
remain real-time; original text/span/CSS/animation assertions and deadlines
remain. An intermediate clock setup froze pending reveal in Chromium and
was corrected before the final run. No production timing was changed.
`browser-integration.md`, initial/focused logs and archived traces preserve
the earlier failures and diagnosis.

The remaining browser failure is an observed environment limit, not a green
check: the identical conventional upstream H.264 High/yuv420p MP4 (11,030
bytes, 160 x 90, 3 seconds) decodes over direct HTTP in Chromium 153 and
Windows Playwright WebKit 26.6. A standalone raw `<video>` using a
`Blob(type: video/mp4)`, without React or app code, decodes in Chromium but
fails immediately in this WebKit executable with media error 4, readyState 0
and networkState 3. The decoder is present; Blob transport fails. The MP4,
product behavior and video assertions were retained. No skip, alternative
fixture or global codec installation was used. Proof is in
`video-diagnostics.json`, `video-diagnostics.log` and
`video-fixture-ffprobe.log`. WebKit Blob-video acceptance remains unverified.

## Accepted native live check

Only attempt 3 supplies acceptance evidence. It launched from the freshly
empty folder
`C:/Users/nooro/AppData/Local/Temp/monocode-r28-live-655472486af5/empty-cwd`,
with identifier `com.monocode.desktop.r28-upstream-0-12-test`, using the
byte-identical copied executable `bin/r28-isolated-preview.exe`. SHA256:
`8B0E73E3E8E48A02CFAB90BB193F82C3B8C796E43CAD70B8FF805FD9E9E97731`.
Native PID 126140 and its WebView/CDP PID 94736 were linked by OS process
ancestry; that WebView owned loopback CDP port 9478 and sandbox browser data.
The Windows single-instance dependency was verified to derive instance names
from the app identifier, and the actual runtime returned the unique R28 id.

Direct process-environment inspection proved `CODEX_HOME`, every `ORCA_*`
and every `MONOCODE_*` variable absent. Profile/home, Windows AppData,
WebView, npm prefix/cache/config and temp paths were isolated, provider
credentials were removed, and PATH omitted Node/npm/provider directories.
Runtime version was 0.12.0, product `home_dir` and app-data paths resolved
inside the sandbox, and the initial native workspace snapshot was null.
Proof: `preview-launch.json`, `live-initial-native.json`,
`live-process-proof.json` and `live-environment.json`.

Disposable Git projects A/B and B's `r28-task` worktree were created only
inside the sandbox. Four completed synthetic sessions were seeded through
the real native store after independently checking its identity and path
boundaries. No provider session IDs or prompts were supplied. Actual WebView
UI clicks opened the native folder chooser. Its controls were not settable
through Orca UIA, so a reviewed helper targeted only the preview PID's real
dialog, validated the fixture directory, set/read back its Edit control and
clicked its actual Select Folder button. No native results, React state or
localStorage were mocked or injected to establish UI acceptance.

| Required behavior | Live result |
| --- | --- |
| App starts on 0.12.0 | Actual native runtime returned 0.12.0 and the isolated identifier. |
| New session opens in the right project | Opened A, selected B, then clicked New session. Session `68332dcc-64c5-44fc-a3cc-3c8ed393cd1e` had B's sandbox cwd and was focused in new tab `50956bcb-6d36-4f2f-8415-1dc6ccb7597a`. |
| Tree shows worktrees and sessions | B's `r28-task` displayed both seeded session rows. Opening Tree One focused B with `worktreeCwd` set to its disposable `project-b-task` checkout. |
| Worktree row toggles its sessions | Actual row clicks changed listed rows `2 -> 0 -> 2`, keeping active tab and focused session unchanged. |

Screenshots and current UI-state JSON are retained as
`live-project-a-active.png`, `live-project-b-before-new.*`,
`live-project-b-new-session.*`, `live-tree-expanded.*`,
`live-tree-collapsed.*`, `live-tree-reexpanded.*` and
`live-tree-session-open.*`. Current React state was inspected read-only for
focus evidence. The primary agent independently reviewed screenshots and JSON.

Only the preview PID was stopped. Its native process, WebView and CDP
listener are absent. The stopped SQLite store was inspected read-only: all
four saved sessions are synthetic, all session/snapshot roots are inside the
sandbox, and provider session IDs are absent. Disposable repositories and
the fixture worktree were retained. Protected-path samples before/after
showed no changes to sampled Node/Codex files, installed MonoCode root files
or production-profile top-level metadata/hashes; npm prefix was unchanged
(`system-boundary-before.json`, `system-boundary-after.json`,
`system-boundary-comparison.json`). This is a bounded comparison, not a
recursive certification of every production file. No installed-app or
production-profile operation was targeted by this round.

Attempts 1 and 2 are excluded. They exited before fixture/UI mutations;
attempt 2 captured exit 101 with Tauri setup `unknown path`. WinAPI and
dependency-source review confirmed missing isolated-profile Windows Known
Folder directories: default lookup returned `0x80070003`, while unchecked
lookup resolved sandbox `profile/AppData/Roaming` and `AppData/Local`.
Creating those sandbox-only directories and aligning APPDATA/LOCALAPPDATA
fixed startup. No application source or binary change was required. The
receipts, diagnostic logs and stopped-process proofs are retained.

## Remaining limits

Not verified: Windows WebKit Blob-MP4 playback, macOS/Linux runtime, the
macOS-only roster execution, live provider authentication/execution,
real-forge PR/repair workflows, signed release packaging or advisory
remediation. Existing frontend/host skips remain; the ignored Rust test
requires its loopback SSH fixture. The normal A-to-B switch was proven live;
the narrower A-still-active/B-selected stale-default case remains covered by
helper tests and source review. Mono-launched session panels have unit/source
coverage, without a live provider launch. No deployment or promotion occurred.
