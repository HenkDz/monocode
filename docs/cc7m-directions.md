# CC7M: Mission control design directions

Three clickable design previews replace the empty goal list with a useful org
home. This round changes documentation only; the user chooses a direction before
phase 2. Start with [Cockpit](cc7m/cockpit.html), [Board](cc7m/board.html) or
[Stream](cc7m/stream.html). Each opens directly from disk, shares the existing
MonoCode theme snapshot, and uses synthetic data with no app runtime or backend.

| Direction | Strengths | Tradeoff | Relative implementation cost |
| --- | --- | --- | --- |
| **A · Cockpit** | People first. Project agent cards make blockers and availability easy to scan. Command, attention and recent work remain useful with zero goals. Goals and their chains sit in a contextual drawer. | Cards take more space with a large roster; large organizations will need a bounded/virtualized grid. | Medium: org roster projection, card grid and shared drawers; reuse existing goal, attention and routing adapters. |
| **B · Board** | Planning / Working / In review / Blocked / Done today make work ownership clear. Org rail keeps the people visible beside the board. | Sparse goals leave empty lanes. At 900 px the rail moves below the board; lanes wrap instead of shrinking cards. | Highest: lane derivation and stable order, responsive rail and history paging. Drag/drop is deliberately absent. |
| **C · Stream** | Dense, linear overview works well for keyboard users and larger teams. Compact is the default; Overview / Goals / Attention / Activity switch the main surface. | Less spatial separation than cards; new users must learn the row columns. | Lowest layout cost: existing projections into rows, with shared drawers and paged history. A large roster still needs virtualization. |

**Recommended starting point: A.** It best answers the zero-goals problem and
makes the blocked Reviewer obvious. C is the strongest alternative for frequent
keyboard use. B suits a user who primarily manages many parallel goals. This is
a recommendation, not a selected implementation direction.

## Shared behavior

Every direction has eight agents grouped by project, two live goals, three idle
members, one Manager-owned approval, a storage-blocked Reviewer and a recent
synthetic human-approved merge. Zero-goals mode preserves independently queued
project work, the org roster, attention and recent history. It does not mean
every member is idle. The missing `mc-current-empty.png` is handled using the
coordinator's description: blank home, Live goals 0 and Finished 0 disclosure.

Project/state filters, comfortable/compact density, dark/light theme, clickable
members and goals, command intent/route overrides and worktree Active/All paging
work locally. Sidebar idle chips remain below their heading. There are no
accordions or disclosure triangles. `j` / `k` navigate live items, Enter opens,
Escape closes and returns focus, and `/` focuses the command. Text entry keeps
its normal keys. Dialogs use native modal focus handling; menu selection returns
focus to its visible trigger. Command drafts survive view changes.

Chat defaults to Grand Orch. Explicit New goal plus an eligible selected or
exactly named synthetic project displays **Send to &lt;project&gt; Manager**.
Cross-project wording, multiple mentions and selected-project contradictions
keep Grand, including when an override is present. This is a small fixture
demonstration, not a second production router; phase 2 calls the CC5C adapter.
Send, message, approval and recovery are local previews and never issue requests.

## Clean time and attention

All goal drawers share a categorical **Planning / Working / Review / Waiting /
Compaction** strip. Equal widths are navigation, not proportional measured
durations. Two key events replace the repeated point-marker wall. Hover/focus
gives a short explanation; selection shows the actor, scope and uncertainty.
Current-attempt elapsed is distinct from exact model/tool phase duration. Review
without a start says Not started; planning/compaction without receipts say —.
Captured compaction boundaries retain their exact duration. Review-outstanding
wait can overlap work; it is never summed into a wall-time total.

**Ledger** is an explicit alternative tab, initially absent. It pages four
events at a time and exposes exact actor/turn/dispatch, timing and evidence on
selection. No giant always-visible table, expanded lane detail, or accordion.
Both goal fixtures retain their own actors and event identities. Phase 2 should
adapt CC7E's correct projection without recreating event capture or inferring
phases from silence.

Attention stays a terse two-item home strip. Inbox opens Open / Approvals /
Decisions / Blockers / Failures / History. A uses compact cards, B uses rail-like
rows, and C uses linear rows plus an inline Attention tab. Evidence and exact
request/account identity appear in selected detail. Blockers lead; unknown age
is —. Approval belongs to the DZDistro Manager; worker requests remain lead
routed. Preview responses retain the queue and create no fictional resolution.
Phase 2 hosts CC7D's existing question, approval, recovery and usage controls in
the selected panel, including storage comparison and preserved-file choices.

## Data needed for phase 2

| Surface | Reuse | Gap / constraint |
| --- | --- | --- |
| All org rosters (A grid, B rail, C rows) | CC4 `selectAgentLiveState`, agent/task metrics; current roster, sessions, runs and exact member identity. CC7P status colors and labels. | Do not derive zero-goals visibility or attention solely from live goal nodes. Current turn / attempt elapsed is not time in state. |
| Goal drawers / C goal rows | CC7C `selectGoalViews`; CC4 delegation edges and goal metrics, saved task/review/dispatch links. | Dependencies are not delegation parents. Tokens can overlap across goals; avoid an org sum. |
| B lanes | Existing queued/running/needs-you/ready/done/cancelled/blocked goal status plus current task/review facts. | Planning/Working/In review are UI derivations, not new ledger statuses. Done today needs a durable completion or verified outcome timestamp; never mutable `updatedAt`. |
| Command | CC5C explicit intent, exact project/path matching, valid Manager roster/registration, route metadata and durable assignment receipt. | Use the shared embedded/floating adapter; no new grant, model classifier or mutation transport. |
| Attention | CC7D projection, source ownership/freshness/deduplication and existing action callbacks. | Keep shared account membership, replaced requests/history and source acknowledgement. Unknown or disappearing evidence cannot prove resolution. |
| Time | CC7E projection, CC4 optional dispatch/start/first-content/finish/report and compaction boundaries. | Planning/working/review categories must preserve unknown phase coverage; current blockers have no inferred historical onset. |
| Recent activity | Recorded completion/review activity and existing verified PR outcome data. | Ready/Done is not proof of a merge. |
| Vitals | Canonical active/idle counts and goal ledger. | Average hand-off and tokens today remain — until captured boundaries and unique session/turn/day aggregation exist. |

References read from `nour` at starting head `1147d9b7`, routing documentation
from `HenkDz/cc5c-routing` at `18f24243`, and CC7D from `nour` at `85f6cf1`.
At the add-on scan, CC7E paths were absent from that `nour` tree; its correct
projection/documentation was read from `HenkDz/cc7e-timeline` at `1995d78` and
its supplied screenshots. No branch was switched or merged.

## Validation and evidence

Windows Node 26.5.0 checks use `NODE_OPTIONS=--no-experimental-webstorage`.

| Check | Result |
| --- | --- |
| Full Vitest (`--maxWorkers=8`, no filtering) | 573 files passed, 2 skipped; 6,583 tests passed, 13 skipped, 0 failed / todo. |
| TypeScript | Passed, exit 0. |
| Production build | Passed, exit 0. |
| Real Chromium mockup verification | 48 layout cases, 432 checks passed, 0 failed; 39 screenshots. |
| Native checks | Not required: no native, host or app source changed. |

The browser matrix covers 1440/1100/900/800 px, dark/light and live/zero goals.
It verifies structure, complete org visibility, no overflow/disclosures, sampled
normal-text contrast, keyboard controls, route safeguards, filter focus,
drawers, local-only actions, phase selection, on-demand ledger paging, attention
categories, theme/density and direct `file:` opening. Screenshots include all
required home cases plus each direction's clean phase drawer, ledger and
attention. See the [screenshot index](cc7m/screenshots/index.md).
Final headed Chromium is 153.0.8010.12; minimum sampled normal-text contrast is
5.038:1. The app checks ran at `1147d9b7`; all round changes are documentation,
so app/native/host/dependency bytes remain that validated baseline.

Evidence: `C:/Users/nooro/AppData/Local/Temp/monocode-cc/cc7m/evidence/`.
`validation/SUMMARY.md`, command receipts and raw logs hold the repository checks;
`browser/verification.json` binds final HTML/CSS/JS/capture bytes and screenshot
hashes. `docs/cc7m/capture.mjs --headed` reproduces the browser checks from an
empty temporary launch folder, synthetic home/profile and separate identifier,
with CODEX_HOME and every ORCA variable removed. Browser/server stop and profile
removal are checked. The first capture retained 24 light-text contrast failures;
the final palette strengthens secondary ink. Earlier receipts remain separate.

No app implementation, real profile/database, live model turn, production
mutation, dependency repair, merge or push. Screen-reader/native/provider
acceptance and large-data virtualization belong to phase 2; sampled contrast is
not a complete accessibility audit. Existing dependency audit and CSS/import/
chunk warnings are recorded in validation evidence.
