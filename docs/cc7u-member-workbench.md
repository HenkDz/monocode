# CC7U: member Workbench and flat task rows

Member conversations and member-owned saved worker sessions use the selected
CC7S Workbench: identity, plain CC4 state/reason and one conversation-turn metric
line above Work and Conversation / Activity columns. Work contains the storage
recovery card, Current / History / All assignments, five-card history pages and
the latest relevant Manager message. The existing composer, attachments, model,
effort, access controls and upstream context meter remain mounted while tabs,
filters and readers change.

## Behavior and implementation

Metrics use canonical conversation-turn elapsedMs and token counters. Exact
cached/input/output counters and scope are in Details; goal wall time is not
presented as turn time. Prepared work without a recorded turn start says
Conversation not started. Unknown counters/clocks remain unavailable.

Message focuses the draft. Steer uses the existing submission boundary and stays
disabled during storage, decision or worktree recovery. Open worktree retains
the selected worker's action. Details and Manager notes reuse house Modal focus
trapping, Escape and return focus. Pointer openers explicitly focus before
opening so WebKit records the right return target. Member settings retain role
source markers and busy/read-only sandbox guards; saved workers omit roster
settings. App.tsx contains only the marked twenty-line sandbox handler seam
relative to the integrated base.

Workbench callers set AgentTranscript's optional flatWork mode. Initial and
streaming prose remain visible, followed by compact CC7T tool rows with full
saved-output readers. Delegated work opens retained steps/report in a reader
with nested tool readers. Existing search, paging, selection, anchoring and
approval commands/request IDs remain intact. The default renderer mode stays
available to other callers. Undelivered messages retain drafts and diagnostics.

Member pending messages retain the bounded queue above the reader and its
original controls. Normal latest-message bottom anchoring remains. Earlier
request text is fully readable through actual wheel scrolling, without permanent
queue overlap; Jump to latest restores the normal position and preserves the
draft. Saved workers render their queue once through the existing Composer.
Historical sessions resolve the original dispatch/workspace for display while
canonical current-task, rotation and recovery state remain authoritative.

Activity retains CC7T chips/timeline. Lifecycle labels read Assigned to Reviewer
and Stopped before starting when the recorded preparation boundary proves it.
Unknown row times are omitted. Assignment readers retain exact Manager/task
identity, cancellation, artifacts, worker navigation and full error diagnostics.

Flat sidebar task rows show state dot, title, member and outcome. Active / All
and historical paging reuse stored preferences. Selected, unread, attention and
dirty rows remain visible outside the history limit. Real ProjectRail arrow
navigation and prior-conversation Actions remain. GRAND ORCH shows a complete
short state with hover/focus detail. Narrow panes use the Work panel toggle while
keeping the conversation, queue controls and composer available.

Rejected: a new state/metrics store or dependency, replacing the transcript with
an Activity-only reader, new execution/recovery authority, hiding queue controls,
forcing initial oldest-request anchoring, and weakening original visibility
assertions. The narrow queue fix restores the proven placement rather than
adding responsive state or changing reader algorithms.

## Files and integration

Production changes relative to the integrated base:

- src/features/sessions/ui/SessionPane.tsx and src/features/monos/ui/workbench.css: Workbench layout, bounded queues and preserved composer/reader plumbing.
- src/features/monos/ui/WorkbenchHeader.tsx, WorkbenchDrawer.tsx, WorkbenchSessionDetails.tsx, ManagerWorkbenchNote.tsx and MemberWorkLog.tsx: identity, scoped metrics, house readers, Manager notes and assignment paging.
- src/features/sessions/ui/AgentTranscript.tsx and src/features/sessions/model/session.ts: optional flat Conversation rendering and retained output readers.
- src/features/monos/model/memberActivity.ts, monoNavigation.ts and src/features/monos/ui/MonoCodexStorageNotice.tsx: natural lifecycle labels, navigation and retained human recovery actions.
- src/features/source-control/ui/ProjectWorktrees.tsx, ProjectWorktrees.css and src/app/shell/MonoRailSection.tsx: flat task rows, persisted paging/navigation guarantees and complete GRAND ORCH state.
- src/app/App.tsx: marked sandbox-handler reuse seam only.

Adjacent unit tests and tests/browser/cc7u-workbench.{html,tsx,spec.ts},
cc7b-member.spec.ts and member-tasks.{tsx,spec.ts} exercise these behaviors.
Documentation includes this report, docs/cc7u/capture.mjs and the screenshot
index/61 PNGs. Capture setup is separate from the unchanged tested fixtures.

## Current validation

Branch: HenkDz/cc7u-member-workbench. Validated source:
d724bc72ec0f43ecb30aeb2da699994014b87c7a. It cleanly merges the coordinator's
validated nour 735455a38d2ee279c5297743ab73ad2267056aef. All seventeen guard
modules match that incoming base: raw ASCII/scope routing, private-only sandbox
repair, durable relocated binding, rotation schema/full receipt and unreadable
continuity guards, and completion-only queue recovery. Native reuse compares
124 unchanged native/Cargo/vendor/fixture files to tested d0c51b2.

Windows / Node 26.5.0, NODE_OPTIONS=--no-experimental-webstorage. All heavy checks
ran sequentially in the granted sole slot with one worker. Every completed web
gate retains identical HEAD and all 1,722 source/config/test hashes.

| Check | Result |
| --- | --- |
| Complete Vitest | 8,181 passed / 13 skipped / 0 failed; 8,194 total. Files 627 passed / 2 skipped / 0 failed; 629 total. 332.52s Vitest / 334.67s wrapper. |
| TypeScript --noEmit | Exit 0, zero diagnostics; 15.35s. |
| Production build | Exit 0; 32.18s wrapper / 16.91s Vite. |
| Complete Chromium + WebKit | 219 passed / 1 known video failure / 0 new failures / 0 skipped/flaky; 220 total. 264.47s Playwright / 266.29s wrapper. |
| Old/new layout and scroll subset | All 42 required cases pass in the complete browser run, both engines; not added to its totals. |
| Native storage, reused exact bytes | 144 passed / 0 failed / 3 existing ignores / 628 filtered. |
| Native harness, reused exact bytes | 26 passed / 0 failed / 0 ignored / 749 filtered. |
| Native Mono, reused exact bytes | 14 passed / 0 failed / 0 ignored / 761 filtered. |

The thirteen unit skips are the existing Antigravity provider suites. The current
known failure is WebKit video-preview.spec.ts:3: metadataReady=false with media
error 4. It remains visibly failed with its unchanged assertion/deadline. Existing
CSS ::highlight, dynamic-import and large-bundle build warnings remain.

The original 719 Workbench browser-spec lines are preserved as an exact prefix.
The added eight cases' incidental setup now uses real wheel scrolling before
the same full-text/viewport/hit checks, the real Jump to latest control and draft
retention, then reads again before unchanged Edit/Save/Remove/scroll checks.
Incoming routing assertions are retained exactly from 735455a.

## Preserved failures and practical limits

At 1ebca046, the first full browser run was 201 passed / 3 failed: two new WebKit
pointer-opener focus failures plus the known video. Explicitly focusing eight
CC7U dialog openers resolved both; the later unchanged cross-browser 16/0 probe
and full 6b9 run passed them.

At 0a7a879, moving the queue into Work made the request initially visible but
failed original queue-access guarantees. The complete exact-pin run remains
211 passed / 9 failed: eight new blocked layout/narrow/edit regressions across
both engines plus known video. Root inspected actual trace events/frames.
That video attempt had metadataReady=false/error=null, separately recorded
from current error 4. No failed run is called green or folded into current totals.
The coordinator clarified scroll-based readability; the proven queue layout was
restored at 7cf4707 before the authorized 735455a merge/current checks.

The first external supplemental history probe assumed oldest-first fixture
ordering and failed its expectation. Actual canonical ordering is newest first,
with reverse insertion order breaking equal start times. The unchanged component
passed both corrected supplemental scenarios; the failed external probe remains
in queue-cancel-history-integrated-probe/. No committed test or product behavior
was changed for that correction.

The initial native deep-path attempt remains 143/1/3 with a 275-character backup
path. The same unchanged code passed in a fresh short synthetic root. Long-path
native behavior remains a follow-up. Native GUI, real WebView2 lifecycle,
foreground activation, live providers and a full screen-reader audit were not
tested. No push, other-worktree mutation, real profile/database repair or live
model turn occurred.

## Visual acceptance and capture-only repair

The final 20-layout comparison set covers five states at 1440/1100px in dark/light.
All 20 pairs were visually inspected against A; the layout, bounded visible queue,
full request access through real scrolling, isolated zero state and narrow
structure were accepted. The initial capture produced 1,693 passed checks,
zero failed checks, 20 layouts and 61 PNGs. Its saved-worker frame additionally
contained a synthetic bridge error that those layout checks did not cover.

The saved-worker fixture's generic IPC fallback returned null for
session_checkpoint_status. Native CheckpointStore::status and the Tauri command
return a non-optional CheckpointStatus with files, including {files:[]} for no
matching checkpoint; failures reject. There is no supported null success path.
The real session-review cache correctly displayed the resulting malformed-mock
error: Couldn’t record changes / Cannot destructure property files of object null.

Only docs/cc7u/capture.mjs repairs that missing response, in the saved capture
page's isolated bridge. It supplies {files:[]} for that command, records/asserts
the exact review-worker/current checkout arguments, and delegates every other
command to the original mock. It asserts absence of the incidental review error
while retaining the genuine storage recovery card, single queue/card, visible Edit
control and Keep my draft. It changes no src/test/config inputs, error handling
or identity assertions. The original noisy saved frame and capture receipt are
archived. Only that frame is rerendered; the other 60 PNG hashes remain identical.
Per the coordinator's instruction, unchanged d724 full gates are retained rather
than repeated solely for a capture-only bridge repair.

The first saved-frame repair attempt remains 1,522 passed / 1 failed: a newly
added capture locator expected a named region, but the saved worker's established
queue uses data-message-queue instead. Original saved-session browser assertions
already scope this queue with that selector. The capture-only locator now uses
the same exact scope and asserts one queue plus one card, unchanged draft
retention, Edit visibility and an additional viewport/elementFromPoint hit check.
This distinguishes a wrong new capture locator from a duplicate/hidden queue;
no original browser assertion was altered. The failed receipt/frame are retained.
The corrected saved-frame-only run passes 1,524 checks / 0 failures and captures
one PNG, including the exact checkpoint arguments, single queue/card, real
recovery, Edit viewport/hit and draft checks. It closes its browser/server and
removes its isolated scratch home. All 1,722 tested source hashes and the other 60
image hashes remain unchanged; capture helper/reference hashes stay stable during
the run. These checks are separate from the original 1,693 layout/capture checks
and are not combined into a fictitious single-run total.

The supplemental real-component probe passes both failed 1440-dark and
long-history 1100-light scenarios: actual wheel-up makes all original request text
visible with its first-line hit in the request; Jump to latest restores anchoring
and keeps the draft; Edit/Cancel and Escape do not mutate the queue; assignment
History/All pages and readers retain exact IDs. Its transcript history fixture
is preloaded. Actual cursor-fetch/failed-load/search/anchor behavior is covered
by the existing hook/scroll unit tests, rather than claimed as database-backed
browser paging. Required full browser tests also pass both engines' original
queue viewport, pointer, focus, paging, draft and saved-dispatch assertions.

## Evidence and final binding

Evidence base: C:/Users/nooro/AppData/Local/Temp/monocode-cc/cc7u/evidence/.

- slot-integrated-final/: current logs/JSON/receipts, manifest, incoming guard/native reuse, validation-summary.json and owned cleanup.
- queue-cancel-history-integrated-probe-corrected/: passed supplemental real Cancel/Escape, assignment-page identity, loaded-history reading and latest/draft proof; original expectation failure remains in the unsuffixed folder.
- slot-integrated-final-visual/: original 20-layout/61-PNG capture, source/reference/image/archive hashes, isolated-zero and real-scrolling assertions, cleanup and review. Its original noisy saved frame is superseded only by the corrected frame below.
- slot-integrated-final-saved-bridge/: original noise archive and preserved 1,522/ 1 failed capture-locator attempt.
- slot-integrated-final-saved-bridge-corrected/: corrected saved-frame capture, exact checkpoint/queue/viewport/hit/draft assertions, source/asset/image hashes and owned cleanup.
- slot-integrated-final/final-binding.json: clean final docs commit, validated1,722-source-file equivalence and combined60+1 image binding.
- slot-final-queue/: retained211/9 run, exact error contexts/traces, trace-inspection and cleanup.
- slot-final/: retained201/3 run; slot-final-focus/: historical6b9 full gates.
- slot-final-focus-visual/pre-layout-fix-screenshots/ and queue-layout-corrected/: archived bottom-anchored/cropped and relocated images; no final-acceptance claims.
- authorized-final/: guard/native results and native-storage-deep-path-failed.log.

[Comparison index](cc7u/screenshots/index.md) is generated only after current
web gates. Working uses the closest Native waiting reference because CC7S has
no working specimen. Failed/long-history implementation frames explicitly show
a reader scrolled through its real control to the original request. Zero pages
start with cleared isolated localStorage. Owned previews and scratch directories
are closed/removed, with source and image hashes retained.

Builder source and visual acceptance are complete. This local committed candidate
awaits the coordinator's fresh independent UI review and integration into nour.
No push was performed.
