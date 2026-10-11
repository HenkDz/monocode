# CC7U: member Workbench and flat task rows

The member conversation and member-owned saved worker session now use the chosen
CC7S Workbench shell: identity and one scoped metric line above Work and
Conversation / Activity columns. Work retains storage recovery, current work,
paged assignment history and the latest message from the member's Manager.
The existing composer, draft/attachment state, model, effort, access controls
and upstream context meter remain mounted while views and filters change.

This round is **blocked on Conversation visual acceptance**. The merged CC7T
renderer intentionally hides preliminary prose and ordinary tools in member
mode. Its ordinary mode introduces work disclosures. The brief says
“Don't edit those renderers,” so an optional flat Workbench mode has been
prepared and previewed, but remains unapplied pending permission. The current
screenshots and the proposal are explicitly separate evidence.

## Implementation

The header reuses CC4 state and its reason, distinguishing a member's assignment
from the actual conversation turn. Current or last recorded turn metrics omit
cached-token noise; exact input, cached subset, output and timing scope are in
the Details drawer. Unknown counters and clocks remain unavailable. A prepared
assignment with no recorded turn start says Conversation not started.

Message focuses the retained composer. Steer uses the existing submission
boundary with an explicit steering option and stays disabled during storage,
decision or worktree recovery. The delivery note follows the existing live
member follow-up behavior. Open worktree uses the existing scoped worker action.
Details is an edge overlay using the house Modal focus trap, Escape handling and
return focus. Member settings reuse MemberDetails; saved worker readers omit
roster settings. Role effort/access resets retain their source markers, and
sandbox controls retain read-only/busy state. App.tsx contains only a marked
extraction of its existing sandbox-change handler for reuse in the drawer.

Assignments use Current / History / All keyboard segments and five-card pages.
Current includes queued and unfinished review work. Cancellation feedback,
exact Manager/task readers, artifacts, worker navigation and diagnostics stay
available. Compact summaries use CC7T's human reason; full error controls remain
in the assignment reader. CC7T Activity uses its existing chips and timeline.
The coordinator-requested polish changes lifecycle labels to Assigned to
Reviewer or Stopped before starting where a preparation boundary proves it.
Unknown row timestamps are omitted rather than repeated as Time not recorded.

Task worktrees use one flat row with state dot, title, member and outcome.
Active / All and historical paging reuse stored preferences. Selected, unread,
attention and dirty worktrees remain outside the history page limit. Prior
conversations remain reachable through the existing Actions menu. The real
ProjectRail owns arrow navigation. GRAND ORCH has a short untruncated state and
context on hover/focus; narrow task metadata wraps. Narrow Workbench panes use
a Work panel toggle while retaining the conversation and composer.

Rejected: a new state/metrics store, a dependency, new provider execution or
recovery authority, replacing the transcript with an Activity-only reader,
changing generic or coordinator chat layouts, and silently editing CC7T's
renderers against the brief. Replacing the transcript would lose its paging,
search, selection and anchoring behavior. The proposed default-off flat flag
reuses MonoActivityTrail and preserves those existing transcript facilities.

## Integration and evidence

The starting branch was HenkDz/cc7u-member-workbench at
6063515992fb01b8ea3220d50958ec4456d279c5. The coordinator explicitly authorized
merging nour into this branch. Local merges include CC7T and CC6 at 1358bb8,
then the approval-command and CC5EI continuity fixes through e3aa079. No other
branch was merged into, pushed, rebased or edited.

[Current comparison captures](cc7u/screenshots/index.md) cover 20 layouts at
1440 and 1100 pixels, dark/light, failed launch, waiting, working, zero and long
history. There are 61 PNGs, including 20 mockup/implementation comparisons and a
saved worker session. The capture has 100 layout/local-render checks and 1,515
source/asset stability checks, all passing. These geometry checks do not close
the known missing Conversation content. The compact card keeps the Manager
note reachable at 1100 pixels. Working uses Native's waiting reference because
CC7S has no working mockup specimen.

Evidence root: C:/Users/nooro/AppData/Local/Temp/monocode-cc/cc7u/evidence/.
browser/verification.json records current screenshot hashes, source hashes and
browser/server/synthetic-home cleanup. The mockup walkthrough passed 38 checks.
flat-work-proposal/ contains four prototype captures and verification.json;
these were built with a temporary Vite transform, not renderer source edits.
The proposal shows initial prose and both tool actions without Conversation
accordions. Its patch is ../flat-work-mode.patch relative to the evidence root.

No real profile/database writes, native app preview, live model turn, push,
deployment or native lifecycle acceptance was performed. Native tests use
synthetic homes. All owned browser/server processes and temporary preview homes
were stopped or removed. Native source changes came only from the authorized
upstream merge; this round's code changes are frontend/UI integration.

## Validation

Current full checks are bound to code/test commit
1b1d2ea1680790948ce4932e71cfc92a18d3e48b. Windows / Node 26.5.0 runs use
NODE_OPTIONS=--no-experimental-webstorage and isolated homes.

| Check | Result |
| --- | --- |
| Full Vitest, four workers | 625 files passed, 2 skipped, 0 failed; 7,794 tests passed, 13 skipped, 0 failed; 7,807 total. 91.52 s in Vitest, 93.45 s including runner. |
| npx tsc --noEmit | Passed, exit 0; 20.72 s. |
| npm run build | Passed, exit 0; 39.83 s. |
| Focused compact assignment reader | 13 passed, 0 failed/skipped. |
| Previous complete browser suite at df84bcd | 187 passed, 1 unchanged WebKit video failure, 0 skipped/flaky; 188 total. 325.50 s including runner. |
| Native codex_mono_store group | 140 passed, 3 ignored, 0 failed; 623 filtered. |
| Native harness group | 26 passed, 0 failed/ignored; 740 filtered. |
| Current implementation capture | 100 layout/render checks and 1,515 stable source/asset hashes; 20 layouts / 61 PNGs; 0 check failures. Visual acceptance remains open. |
| Temporary proposed flat mode | 4 width/theme cases pass prose/tool/no-accordion checks. Proposal-only; unapplied. |

The existing Antigravity provider suites account for the thirteen unit skips.
The prior complete browser failure is video-preview.spec.ts:3 under WebKit,
metadataReady false with media error 4. It was neither skipped nor weakened.
That browser run predates compact failure summaries and the corrected live
delivery note; it is not presented as current final browser acceptance.
Run the complete browser suite and regenerate the comparisons after the
Conversation decision. The native source bytes remain unchanged from the
tested authorized merge, so these scoped native results were not repeated.

Current logs/JSON/receipts are in evidence/validation/. Earlier complete checks
are in evidence/validation-prior-df84/, including browser cleanup.json. The
intermediate 7759095 unit run had 7,793 passes, one stale summary-selector
failure and thirteen skips; its separately retained logs preserve that failure.
The assertion now checks the compact human reason while retaining full reader
coverage; the current complete run has zero failures. Counts are not combined
across runs. Existing CSS ::highlight and bundle/import advisories remain.
