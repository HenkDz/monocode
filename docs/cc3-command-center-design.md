# CC3 Command Center design

MonoCode should open on live goals, their delegation chains and the work waiting on the user. The existing Team map, Inbox, Mono Activity, member work log and session controls remain the detailed views behind that home. This round changes documentation and static design artifacts only.

Audited branch: `HenkDz/cc3-ux-design`, application baseline `de8edc3b389c3362134cc5a521458b241496b4c2`, 2026-10-11. Read the program's COMMON, FINDINGS and CC3/CC4 briefs, the last 80 commits and numbered `docs/r*.md` summaries. The knowledge graph's `list_projects` returned no MonoCode index; the audit used the permitted source-inspection fallback. No real profile database or model session was opened.

## Evidence and what has already shipped

The supplied screenshot is `C:/Users/nooro/AppData/Local/Temp/monocode-cc/screenshot.png`, 1718 × 1390 pixels, SHA-256 `73a35e5d5dc6843006cb06b1db0fd534b41e190aedffe358e6ed70d75346a9fd`. References below use these regions:

- **S1:** selected Reviewer header, x360–600/y0–40, and selected member row, x28–345/y1135–1165: both say Idle.
- **S2:** repair notice, x437–1301/y1228–1382: storage conflict with Repair and Copy details.
- **S3:** project/team tree, x16–346/y337–1320: repeated Idle, four Cancelled tasks, truncated titles, and “Show 5 more · 72 remaining” at y992.
- **S4:** center, x361–1377/y40–1220: large empty transcript area followed by queued draft and completed work cards.
- **S5:** right column, x1378–1717/y40–1389: PR filters, four zero-count headings and No pull requests match.
- **S6:** global navigation, x16–350/y81–246: Search/Ctrl+K, Inbox, Pull requests, Notes, Automations.

This is an observed screenshot, not proof of today's runtime or every code path. Recent source already mitigates parts of S4. Preserve these changes:

| Shipped work | Current evidence | Design consequence |
| --- | --- | --- |
| Separate member work log and independent scrolling | `87f9170`, `efc4589`, `1cfad4c`, `de8edc3`; `MemberWorkLog.tsx:309`, `SessionPane.tsx:1278`; `tests/browser/member-tasks.spec.ts`, `tests/browser/mono-activity-scroll.spec.ts` | Use the existing work/history tray and scroll tests. Do not describe moving work cards out of the transcript as new work. |
| Team map hierarchy, main-area placement, event feed and keyboard controls | `93d2ab4`; `docs/r15-polish.md:3`, `:5`, `:7`; `TeamMap.tsx:434`, `:575` | Keep the spatial org map and directed reporting edges. Home adds a goal lens. |
| Org Activity and shared task lifecycle | `docs/r10-team-feel.md:7`, `docs/r12-test-findings.md:7`, `docs/r13-ui-cleanup.md:31` | Preserve Needs you/Working/Ready/Finished/Feed and shared selectors; extend coverage. |
| Worktree groups, active filter, row/session toggling, deleted-worktree history, per-session providers | `f68170b`, `74325b0`, `4661a0e`, `3f420be`, `15f8aeb`; `docs/r28-upstream-0.12.md:35`, `:57` | Adjust defaults and summaries without losing retained history, provider identity or selection. |
| Compact task-scoped PRs and historic status fallback | `2de07a4`, `f822505`, `bf2b691`; `docs/r19-session-prs-acceptance.md:7` | Reuse PR sources and stable historical anchors. Do not invent a second forge poller. |
| Tree selection/project order/undo, background worktree removal | `ca05d81`, `5430e2e`, `47e2590`, `bd1134d` | Retain Tree width, project ordering and reachable background progress/failures. |
| Stream rendering and manual scroll intent | `214283c`, `3b2943d`, `642d330` | Row-level subscriptions and bounded updates; preserve transcript scroll intent. |
| Review/approval/storage/GitHub budget safeguards | `docs/r8-lifecycle.md:3`, `docs/r24-github-budget.md:7`, `docs/r25-codex-mono-storage.md:5` | No automatic merge, destructive cleanup, authority expansion or claim that a retry repaired storage. CC0 owns repair. |

Also reviewed `docs/r13-visual-evidence.md`, `r19-session-prs-acceptance.md`, `r27-upstream-0.11.md` and `r28-upstream-0.12.md`: component and fixture captures do not establish native/provider acceptance; older validation numbers are historical.

## Main surface inventory

Paths in this table are relative to the repo root. Line numbers are bound to the application baseline above.

| Surface | Source | Present behavior and retained role |
| --- | --- | --- |
| Global sidebar navigation | `src/app/shell/ProjectRail.tsx:389`, `:417`, `:632`, `:749`, `:914`, `:1132` | Search, Inbox, PRs, optional Notes, Automations; projects/groups/order and active-only filter. Home becomes a new destination. |
| Adjacent Sessions/Tree | `src/app/shell/Sidebar.tsx:466` | Focused-worktree context when project rail is open. Keep two-level navigation; avoid another project tree. |
| Monos | `src/app/shell/MonoRailSection.tsx:71`, `:136`, `:185` | Durable rail, saved order, mascots, unread/working/attention badges. It already omits idle text. |
| Managers and members | `src/features/orchestration/ui/ProjectManagerRow.tsx:70`, `:99`, `:182` | Shared status, persisted team expansion, all members shown in expanded teams. |
| Worktrees | `src/features/source-control/ui/ProjectWorktrees.tsx:259`, `:315`, `:512`, `:809` | Your/Task/Finished groups, five-row paging and active/focused/attention/unseen/unfinished exceptions; provider-aware session rows. |
| Session task groups | `src/features/orchestration/ui/OrchestrationSidebarAgents.tsx:74`, `:108`, `:127`, `:220` | Raw task counts called agents, full saved task list, disclosure, attention and cancel controls. |
| Team map | `src/features/teamMap/TeamMap.tsx:314`, `:333`, `:434`, `:575`, `:686` | Org/project scope, Needs-you filter, roving keyboard focus, current task, reporting edges and newest crew events. |
| Search / Ctrl+K | `src/features/search/ui/SearchView.tsx:53`, `:174`, `:333` | All/Conversations/Files/Projects; Arrow/Enter navigation. Retain content search. |
| Command palette / Ctrl+Shift+P | `src/features/files/ui/FilePicker.tsx:40`; `src/features/settings/model/settings.ts:1138`; `src/app/App.tsx:13428` | Existing configurable shortcuts; palette seeds `>` and currently only offers Reload. Extend this entry point. Ctrl+P remains Go to File. |
| Inbox | `src/features/inbox/ui/InboxView.tsx:401`, `:924`, `:938` | Already aggregates Manager decisions/ready/replies, plus external notifications and CI handling. Attention reuses those sources and execution paths. |
| Pull requests | `src/features/pullRequests/ui/PullRequestsView.tsx:59`; `PullRequestsList.tsx:180`, `:203`, `:271` | Main destination and contextual list, keyboard movement, project/agent/status filters, collapsed merged history, zero headings. |
| Notes | `src/features/notes/ui/NotesView.tsx:23`, `:64`, `:96` | Persistent editing, serialized pending saves, add-to-chat. Remains a content destination. |
| Automations | `src/features/automations/ui/AutomationsView.tsx:48`, `:77`, `:134` | Templates, schedules/triggers/runs and shared model/permission/skill pickers. Link failures to attention; retain authoring. |
| Session transcript | `src/features/sessions/ui/SessionPane.tsx:941`, `:1066`, `:1241` | Manager status, pooled transcript, history, linked notices and search/jump. Preserve paging and follow behavior. |
| Composer | `src/features/sessions/ui/Composer.tsx:1737`, `:2346`, `:2574`; `src/features/monos/ui/MonoComposer.tsx` | User queue, installed model/effort controls and Stop; distinct Mono composer. Reuse callbacks. |
| Queued messages | `src/features/sessions/ui/MessageQueue.tsx:48`, `:77`, `:162` | Filters internal envelopes, paused/failure/retry state, steer/edit/remove. Distinguish a chat draft from an orchestration task brief. |
| Member task cards / history | `src/features/monos/ui/MemberWorkLog.tsx:52`, `:309`, `:334`, `:370` | Current/attention counts, completed/cancelled history, independently scrolling task tray and task-detail modal. |
| Notices / questions / usage | `SessionPane.tsx:1279`, `:1293`, `:1302`; `src/features/monos/ui/MonoCodexStorageNotice.tsx:25`, `:47`, `:69` | Storage status/repair/errors/copy; pending questions; usage-limit model/account/resume actions. Preserve all error details. |
| Mono right panel | `src/features/monos/ui/MonoDetails.tsx:253`, `:278`, `:309`; `MonoSidebar.tsx:6`, `:28`, `:49` | Details/Activity/PRs, role-sensitive scope, model/effort/permissions and resizable inert closed frame. |
| Session right panel | `src/features/sessions/ui/SessionRightPanel.tsx:8` | PRs default, Activity and session/worktree/model Details. Make automatic opening content-aware. |
| Mono turn Activity | `src/features/monos/ui/MonoActivityPanel.tsx:35` | Working/Finished summary, approvals and Show work reader. |
| Org/team Activity | `src/features/monos/ui/MonoTeamActivity.tsx:301`, `:347`; `MonoOrgActivity.tsx:148`, `:170`, `:233` | Roster, counted tabs, accessible tab keyboard handling, shared current task/state and dispatch elapsed. Use for drilldown. |

## Fifteen problems, ranked by impact

Impact combines the chance of missing stalled work, time spent navigating and frequency in the measured baseline. This is a qualitative ranking, not an invented UX score. “Source gap” means an inference from inspected code, not a behavior observed in the screenshot.

| Rank | Problem and consequence | Evidence | Response |
| ---: | --- | --- | --- |
| 1 | No persistent goal-first home; understanding the whole org requires context switches. | S4/S6; `App.tsx:15055`, `:15362`; org Activity nested in `MonoDetails.tsx:286` | Home aggregates existing goals, owners, state and attention. Keep Team map. |
| 2 | Idle masks work that cannot proceed. | S1 + S2; `src/features/monos/model/mono.ts:746`, `:774` omits storage/outbox facts and returns idle when not busy | Consume CC4's honest state and reason everywhere. |
| 3 | Blockers/failures are missing from shared attention, and actions require opening chats. | S2; `monoTeamActivity.ts:143`, `InboxView.tsx:924` cover decisions/approvals/ready/replies, not complete operational attention | Add routed, deduplicated blocker/failure rows and scoped inline actions. |
| 4 | Steering is scattered across queue, composer, Details and task modals. | Source gap; `MessageQueue.tsx:172`, `Composer.tsx:2346`, `:2574`, `MonoTeamPage.tsx:244` | One capability model, reused inline and in the existing palette. |
| 5 | Org reporting hierarchy does not reveal a goal's actual delegation/review chain. | S3; `TeamMap.tsx:434`, `:669`; `orchestrationState.ts:92` | Show goal/Manager/task/dispatch and reviewer edges by IDs. |
| 6 | Elapsed labels conceal model time, queue waits, compaction and serial review loops. | S4; `MonoOrgActivity.tsx:170`; FINDINGS latency/compaction analysis | CC4-backed parallel lanes plus accessible event ledger. Unknown intervals remain unknown. |
| 7 | Idle members repeat low-value labels and push active work down. | S3; `ProjectManagerRow.tsx:182`, `:212` | Fold idle members; keep selection, working, attention and unread exceptions. |
| 8 | Historical worktree volume dominates default navigation despite existing groups/filter. | S3, 72 remaining; `ProjectWorktrees.tsx:282`, `:809` | Active default, project/goal grouping and explicit History. Preserve dirty/focus/retained work. |
| 9 | Cancelled task groups appear as unfinished coordination. | S3, 0/4 done/all Cancelled; `OrchestrationSidebarAgents.tsx:74`, `:108` | Current/history split; counts say tasks and separate completed/cancelled. |
| 10 | Empty member transcript consumes prime space while useful next actions sit below it. | S4; `SessionPane.tsx:963`, `:1278`; recent tray changes already mitigate this | Current assignment/state/queue summary above existing work log; keep Conversation reachable. |
| 11 | Empty contextual PRs consume a full column. | S5; `MonoSidebar.tsx:6`, `MonoDetails.tsx:278`, `PullRequestsList.tsx:271` | Automatic panel visibility based on real contextual content; explicit Open still shows useful empty/error states. |
| 12 | Keyboard navigation finds content but cannot act on a scoped agent/task. | S6; `SearchView.tsx:53`; `FilePicker.tsx:40`; `settings.ts:1140` | Extend Ctrl+Shift+P; preserve Ctrl+K. Search can switch to a Commands scope. |
| 13 | Counts and status vocabulary conflict across tasks and members. | S3; `OrchestrationSidebarAgents.tsx:74`, `ProjectManagerReview.tsx:50`, `MemberWorkLog.tsx:370` | Shared lifecycle/availability selectors and clearly labelled count populations. |
| 14 | Pane resizing lacks keyboard operation. | Source gap; `ProjectRail.tsx:611`, `MonoSidebar.tsx:71` pointer-only separators | Focusable separator, Arrow/Home/End width controls and accessible current size. |
| 15 | Truncation and small dim labels impede identification, focus and readability. | S3; `ProjectManagerRow.tsx:195`, `:212`, `OrchestrationSidebarAgents.tsx:156`, `ProjectWorktrees.tsx:614` | Focus-visible full title, readable state text, zoom/contrast tests and non-color cues. Screenshot alone does not establish a WCAG failure. |

## Core views

### Mission control: the home

Open the org home from a persistent sidebar item and a palette command. Returning from a member/goal restores home filters and scroll position. Live goals lead; Finished is explicit history. Each row includes title, project, owner, wall elapsed, attention count and coverage-labelled tokens/cost. The chain reads Grand Orch → Manager → workers, with review edges tied to the implementation dispatch. A Manager is a conversation/engine node, not a fabricated task record.

Every node shows availability and reason: Thinking, Running a tool, Compacting, Waiting for review, Waiting on member, Queued with reason, Blocked with reason, Needs you, Idle, Done or Failed. Use CC4's selector; an idle Manager with busy descendants says “Waiting on members · 2”, not Thinking. Elapsed text identifies what it measures: goal wall time, current attempt, current turn or time in state. Tokens are scoped to the goal contribution; current-turn versus historical tokens are separate. Show `— · unavailable` rather than a false zero when unsupported. A dispatched review whose provider never started can show confirmed zero execution, not a simulated running spinner.

Home has no default right panel. Selecting a goal/node can open contextual details; an obvious link opens the current worker session or existing Mono conversation, identified separately. At 900px, worker branches wrap below their Manager. At narrow widths, the ordered chain stacks and sidebar turns into a compact view navigator. Never discard nodes just because the viewport shrinks.

**Data:** existing `MonoManagerGoal`, roster and orchestration records; derived goal/run/task/review joins; CC4 state, per-attempt timestamps and metrics; a new UI projection for filtered goal/node rows. Cost is a separate gap, described below. See [mission-control.html](cc3/mission-control.html).

### Attention queue

Extend existing Inbox/Activity attention sources into an org queue for approvals, decisions, storage/preparation/usage blockers, queue-delivery errors, failed tasks, CI/automation failures and failed background operations. Each row shows the request, exact goal/project/member/attempt, age, owner/routed-to, evidence excerpt and original action. Urgent inability to continue comes first, then age; filters preserve discoverability.

Worker requests continue to route through their lead. `approvalToast.ts:63` deliberately excludes orchestration workers from direct user notifications. Only an explicitly user-owned or lead-escalated request has user Approve/Deny/Answer controls. A blocker can be visible org-wide without becoming a user approval. The approval in the mockup is explicitly Manager-escalated.

Inline actions reuse original request handlers: Allow once/Deny, structured answer, CC0 repair, account/model/resume, inspect failure, or review retry. Show pending, success, refusal and failure; retain evidence. Revalidate request/task/dispatch identity at click time, so a stale response cannot affect a later request. Deduplicate by request identity and owning session/attempt; retain links to all affected goals. Resolved items move to history after acknowledgement. No “approve all”, automatic merge, silent blocker dismissal or retry loop.

**Data:** existing approvals/questions, storage/usage/queue facts, task/run errors, Inbox/automation/background events; new derived row adapter/deduplication; CC4 reason/freshness; CC0 repair outcome. No new mutation transport. See [attention.html](cc3/attention.html).

### Delegation timeline per goal

Render a wall-clock axis with one lane per actor/attempt, assignment and report milestones, model/tool phases, queue/wait phases, compaction and review attempts. Review 1 → fix → review 2 keeps all attempts and the exact reviewed implementation dispatch. Selecting an interval opens its existing work reader, request or task detail.

Model, tool, waiting, compaction and review phases have labels and an equivalent interval/event table. Waiting-for-review on the Manager lane may overlap review/model activity on the reviewer lane; never sum those into wall time. Show elapsed time since dispatch separately from first-token latency and provider turn start. “Observed first content” is not necessarily the first model call. Do not label inference from silence as model time. Missing telemetry is hatched/labelled Unknown, never reconstructed from mutable `updatedAt`, prose, or the baseline's medians.

**Data:** baseline durable IDs/review links and coarse dispatch start/update exist. Committed CC4 supplies optional stable dispatch/start/first-content/end/report fields and compaction/metrics events. Full model/tool phase intervals still need provider-supported timing; call count alone cannot draw them. A new display model makes parallel intervals and review edges; it does not own event capture. See [timeline.html](cc3/timeline.html), including the text interval ledger.

### Steering: palette and inline controls

Extend the existing Ctrl+Shift+P palette with a target scope shown as member · project · goal · task/dispatch. Ctrl+K retains search and offers an explicit Commands switch; Ctrl+P retains file opening. Respect saved shortcut overrides. Arrow keys select, Enter opens an action sheet, Escape returns focus to the invoker. Model/effort choices come from the installed catalog and existing ModelPicker/ModelSettings.

The same capability selector drives palette and inline Message, Redirect, Cancel, Reassign and next-turn Model/Effort. Distinguish stopping a session, cancelling a task and cancelling a goal. Actions show the exact target and delivery receipt. A queued message remains “accepted into queue” until provider delivery is proven. An unsupported live redirect explains the limitation and offers a queued next turn. Model/effort changes show selected-next versus currently running provenance; a picker change does not change an in-flight model call.

| Action | Today's inspected capability | Implementation treatment |
| --- | --- | --- |
| Message durable Mono/member | Existing chat/outbox/team route, `App.tsx:12254` | Reuse delivery flow; distinguish durable chat from task worker session. |
| Message a stopped task | `orchestration.ts:1908` | Same task correction turn; rejects active/queued tasks and started dependents. |
| Redirect running task | `orchestration.ts:1991`; `App.tsx:11530` | Existing provider-dependent `steer`; preserve capability rejection. |
| Edit queued task brief | Gap: message rejects queued tasks at `:1910` despite steer guidance at `:1996` | New backend work. Do not wire a pretend edit action to message. Existing MessageQueue edit is only chat queue editing. |
| Cancel task / goal | `orchestration.ts:2733`; `monoManagerGoals.ts:125` | Show Cancelling until confirmed stop; preserve work/history and prevent later dispatch after goal cancellation. |
| Recovery reassign | `orchestration.ts:1670`; `App.tsx:12153` | Existing constrained recovery: eligible reason, stopped, unaccepted, no started dependents, same scope/checkout; cannot bypass safety refusal. |
| Move to a different named member | Gap | New validated transfer with history, reviewer independence and confirmed-stop rules; no arbitrary scope/team expansion. |
| Model/effort next turn | `App.tsx:7112`, `:7165`; `session.ts:509`; `ModelSettings.tsx:35` | Reuse provider catalog and staged handoff; active-worker changes limited to supported recovery. |
| Approve/deny/answer | `orchestration.ts:2011`; `App.tsx:11561` | Preserve structured request IDs, ownership and live revalidation. |

Queued-edit and named-member transfer in the mockups are **proposed controls**, not shipped capabilities. Until the backend round lands, hide them or show a disabled explanation. Reassignment confirms the exact task and preserves task brief, revision, scope, approval ownership and prior attempt. If a running task does not acknowledge stop, no replacement starts. Keep current merge/destructive approval rules and gentle defaults for reversible navigation/messages.

**Data:** current task/run/session/request, catalog and permission facts exist; new derived capability/action-target projection; new backend contracts only for the two gaps above. See [steering.html](cc3/steering.html).

### Sidebar: active work with accessible history

Keep saved project order, groups, mascot/provider identity and rail modes. Fold Idle members under “N idle members”; expand or pin the selected, unread, needs-you, queued or active member. Use the same honest state label as home. Never turn a Manager's descendant activity into its own provider status.

Default to active worktrees grouped by project and goal/run, with a compact historical count and searchable All/History. Preserve primary checkout, focused, dirty, busy, unread/attention, retained work and unfinished task worktrees even when filtered. Existing five-row paging remains useful after prioritization. Cancelled/finished task groups move to history; merged PR history is explicit. These are navigation filters, never record or checkout deletion. Task counts distinguish active, accepted/completed and cancelled; don't call four tasks four agents.

**Data:** existing roster/task/worktree/PR lifecycle and expansion preferences; derived visible groups/counts using CC4 states. No new backend. The shared sidebar is present in every mockup.

### Member view: current work first

Show member identity, role/project/reporting owner, current availability/reason, latest event freshness and assignment above the fold. For an empty transcript, lead with Current assignment, Queue and compact Work log. Keep the newly shipped MemberWorkLog and its current/history split; detailed task output opens the existing work reader. Conversation remains one step away and preserves scroll/history/composer behavior. Activity remains a separate drilldown.

Storage/preparation and usage notices sit next to the affected queue/assignment. “No model turn running” is explicit when the member is blocked before dispatch. The composer says Queue message when delivery is blocked, shows actual reason and retains the draft. Current worker, durable member conversation and historical task metrics are clearly distinguished. Model/effort are next-turn controls; permissions and exact checkout stay visible in Details.

**Data:** existing member/profile, `memberTasks`, session queue/notice, task/worktree and work reader; CC4 state/current-turn metrics; a new layout projection only. See [member.html](cc3/member.html).

### Right panel: contextual and reversible

Automatic opening requires useful details, current activity/attention or related PR content for the selected entity. Home starts closed; member/goal mockups show a panel because they have concrete context. Loading, failed fetch and filter-empty are meaningful states, not proof of no content. An explicitly opened panel stays open with an explanatory empty state and Reset filters/Open all PRs. A user-pinned panel is not silently closed as results stream. Explicit Close/Open and tab/width preferences remain per existing patterns.

Scope follows the selected goal/task/member; show that scope and a deliberate switch to org/project. Reuse the central PR budget/cache, not new refresh loops. Details/Activity/PR tabs and artifact readers remain; zero-count headings can collapse without losing history. All pane resizing works by keyboard as well as pointer.

**Data:** existing contextual details/activity and scoped PR results/loading/error/filter state; a derived content/visibility selector plus existing user preference. No new provider or forge model.

## Data foundation and CC4 alignment

Read `HenkDz/cc4-live-state` using `git rev-parse`, `git log`, `git diff` and `git show`, without opening or changing its worktree. At the initial 10:11 UTC audit it was still the application baseline and had no committed contract. Before completion it advanced to **`32b62c595e319d7071aeab74846c7ef0d0382345`**. Read that commit's `docs/cc4-live-state.md` and its three model modules. CC3's application baseline and screenshots are unchanged; the new contract is aligned here without merging CC4.

The committed consumer APIs are:

- `src/features/agents/model/agentLiveState.ts`: `selectAgentLiveState(session?, context?)`, `agentLiveStateLabel`, `agentLiveStateTooltip`; context accepts task/tasks/runStatus/pauseReason. `AgentStatusLabel` is the shared UI label. Storage errors outrank activity/outbox; preparation is queued, with a reason. `MonoState.liveState` carries the detailed state alongside coarse compatibility styling.
- `src/features/agents/model/agentMetrics.ts`: `selectAgentMetrics`, `selectTaskMetrics`, `selectGoalMetrics`, `selectDelegationEdges`. `AgentMetrics.partial` describes observed coverage. Its `elapsedMs` sums observed turn durations; it is **not goal wall elapsed**, nor model-computation time. Edges expose `dispatchedAt` and optional provider-start/first-content/finish/report times, plus manager engine/Mono/session identities. Join reviewer `reviewOf` separately.
- `src/features/agents/model/turnMetrics.ts`: shared capture attaches first observed nonempty assistant/reasoning/plan text, counters/call IDs and compaction boundaries to the submitted user turn. Persistence uses existing `blocks_json`; steering/outbox bubbles do not own new turns. `managerTurnBlockId` and dispatch `turnBlockId`/`reportedTurnBlockId` provide precise attribution; unloaded dispatch snapshots retain recorded metrics.

CC4 intentionally preserves provider counter semantics: Codex input includes cached input; Claude/Pi/OpenCode report uncached input separately. Show provider-aware input/cached/output counters until a display adapter can safely normalize them. A shared Manager report turn can belong in full to several goals: **independent goal totals overlap and must not be added into an org total**. A global total requires deduplication across all selected session/turn IDs. Cost, provider-unavailable call detail and complete model/tool phase intervals remain gaps.

E = existing baseline facts; D = new UI derivation; N = CC4 capture/selector now committed on the branch above, not yet merged into CC3; G = gap requiring additional work or an explicit unavailable display. Source locations below describe the original baseline when contrasting it with CC4. Recheck the CC4 tip and contract at integration rather than copying those baseline implementations.

| Field needed by views | Class | Current source and semantics |
| --- | --- | --- |
| Roster, role, reporting/reviewer, durable session, provider profile | E | `src/features/monos/model/mono.ts:37`; TeamMap cycle/missing-parent guards at `model.ts:96` |
| Goal/title/project/owner/lifecycle | E | `monoManagerGoals.ts:23`; goal ledger persistence at `:101` |
| Goal → Manager run → task → dispatch | D/N | Baseline join `goal.managerId === run.leadId` and `task.monoGoalId === goal.id`, `monoManagerGoals.ts:409`; `orchestrationState.ts:86`, `:149`. CC4 edges add exact manager/session/turn attribution. |
| Review attempt → reviewed task/dispatch | E/D | `reviewOf`, verdict and accepted dispatch IDs, `orchestrationState.ts:92`; preserve all dispatch attempts |
| General nested parentTaskId | G | No general delegation parent in `orchestrationState.ts:71`; `dependsOn` is a scheduling relation, not parenthood. Add only if actual nested delegation needs it. |
| Busy, queue/status, storage/preparing, usage, pending questions | E | `session.ts:473`, `:539`; these are partly transient |
| One honest state/reason; observed freshness | N/D | Baseline `MonoStatus` only working/needs-you/idle at `mono.ts:722`. Committed CC4 owns the pure selector and precedence; views do not recreate it. Its state type has no timestamp: derive labelled freshness from actual captured events. |
| Current tool / work phrase | E/D | `mono.ts:779`, `monoWorkStatus.ts:30`; current-turn scoped. `liveAgents.ts:23` excludes orchestration workers and is not an org selector. |
| User turn wall start/end | E | `Block.startedAt/durationMs/sentAt`, `session.ts:324`; `apply.ts:714` |
| Dispatch start/update | E | `orchestrationState.ts:49`; external preparation starts after this, `orchestration.ts:2492`. Update is mutable. |
| Immutable dispatch/provider-start/first-content/finish/report times | N | CC4 optional dispatch fields and delegation edges have separate meanings/IDs; old rows stay unknown. Dispatch start is not first token. |
| Input/cached/output tokens | E → N normalization | `TurnMetrics`, `session.ts:308`; `HarnessEvent turn.metrics`, `core/types.ts:158`; stored at `sessionStore.ts:986` |
| Full-turn totals, deduplication and model-call count | N/G | Baseline Codex latest-request overwrite at `codexProtocol.ts:563`, `apply.ts:235`. CC4 capture/roll-ups retain recorded counters and deduplicate known call/turn IDs, with partial/unavailable fields. Provider-unavailable calls and old samples remain incomplete; don't relabel them complete spend. |
| Structured compaction intervals | N/G | Baseline Codex dropped compaction at `codexProtocol.ts:551`. CC4 now captures structured start/end boundaries; either boundary may be absent. Full model/tool phase interval capture is separate follow-up. |
| Agent/task/goal metrics roll-up | N | CC4 selectors attribute unique session/turn/dispatch records within each goal; count retries/reviews once, retain partial coverage. Shared report turns can overlap across goals; global totals need their own deduplication. |
| Cost estimate or billed cost | G | No baseline cost/pricing contract; not in CC4's required capture list. Use unavailable until model/rate/cache/currency/provenance support exists. Subscription tokens are not billed dollars. |
| Attention request identity/ownership | E/D | `Block.approval`, `session.ts:358`; `pendingQuestion`, `:539`; `approvalToast.ts:14`, `:63`; derived stable row IDs and routed-to lead |
| Goal/task attention and scheduling waits | E/D → N state | `monoManagerGoals.ts:419`; `orchestration.ts:1563`; queue reasons include review/dependency/file/slot. Not every blocker asks the user to act. |
| Historical dispatch/report/review/PR activity | E/D | `MonoOrgActivity.tsx:26`; `teamMap/model.ts:432`; title fallback at `:531` is unsuitable for precise metrics lineage. |
| Sidebar groups / contextual-panel visibility | D | Existing records and preferences; preserve selection/unread/dirty/history and explicit-open state. |

All new view projections should include stable goal/task/dispatch/session/turn identity, display state/reason, measurement scope, observed time and coverage (`complete`, `partial`, `unavailable`). Adapt CC4's `partial` flag and absent values into this display vocabulary; this is not a replacement core type. An absent value is `—`; a measured zero is `0`. Codex cached input is a subset and must not be added again; other providers need their documented uncached/cache semantics. Do not sum mixed-provider raw counters into a misleading token total. Goal tokens use unique attributed turns within that goal, not manager aggregate plus the same workers; overlapping goal totals are not an org total. Goal wall time is an interval, not CC4's sum of observed turn durations.

Costs in the mockups are synthetic illustrative estimates. Real views launch with unavailable cost where no trustworthy cost source exists. Adding rate catalogs or cost estimation is optional follow-up, not a prerequisite to honest status/home. Historical Codex data cannot be made complete by relabelling latest-request metrics.

## Implementation rounds and parallel ownership

Quick wins come first. CC4 owns live state/metrics/capture and its small status/card changes; CC0 owns repair. No later round edits their files concurrently. Names below are proposed round labels for the coordinator, not newly scheduled work.

| Round / order | Exclusive files or directory ownership | Dependencies and acceptance |
| --- | --- | --- |
| **CC5A — sidebar quick wins** | `src/app/shell/ProjectRail.tsx`; `src/features/orchestration/ui/ProjectManagerRow.tsx`, `OrchestrationSidebarAgents.tsx`; `src/features/source-control/ui/ProjectWorktrees.tsx`; their tests only | After CC4's status integration. Tests: idle fold preserves selection/unread/attention, active/history filtering retains dirty/focused/unfinished work, consistent cancelled counts, persisted order/expansion, keyboard resize. Isolated screenshots: 72 historical worktrees, all-cancelled group, idle team, storage-held Reviewer, dark/light/narrow. |
| **CC5B — member and contextual-panel quick wins** | `src/features/sessions/ui/SessionPane.tsx`, `SessionRightPanel.tsx`; `src/features/monos/ui/MemberWorkLog.tsx`, `MonoDetails.tsx`, `MonoSidebar.tsx`; `src/features/pullRequests/ui/PullRequestsList.tsx`; associated tests/fixtures | After CC0/CC4; parallel with A. Tests: current/queue/history distinction, notices never obscured, independent scroll and original browser regressions, content/loading/error/filter-empty/explicit-open/pinned panel states, keyboard resizing and focus restoration. Screenshots: empty member transcript, long work log, blocked queue, empty/loaded PR context. |
| **CC5C — mission control** | New `src/features/commandCenter/ui/MissionControl.tsx`, `GoalChain.tsx`; `model/goalView.ts`; their tests/fixtures | CC4 contract first; parallel with A/B/D/E/F. Tests: multiple simultaneous goals, shared Manager/Grand sessions, missing/cyclic roster links, retries/reviewer linkage, no double counting, unavailable telemetry, list expansion and return navigation. Screenshots: two live goals, blocked chain, long titles, dark/light/900px/390px. |
| **CC5D — attention** | New `commandCenter/ui/AttentionQueue.tsx`, `model/attention.ts`; their tests/fixtures. Existing Inbox adapters may be added under this new folder; avoid editing Inbox view while F changes search. | CC0/CC4 + existing execution callback contracts; consume F capabilities when available. Tests: stable deduplication, lead-routed worker request, user escalation, stale/replaced request, structured answer, failed repair/retry/delivery, resolved history. Screenshots: approval, decision, storage/usage blocker, failure, action pending/error. |
| **CC5E — delegation timeline** | New `commandCenter/ui/DelegationTimeline.tsx`, `model/timeline.ts`; their tests/fixtures | CC4 immutable event contract; parallel with C/D. Tests: model/tool/wait overlap, missing first token, compaction, out-of-order/duplicate events, interruption, restored legacy gaps, review→fix→review attempts. Screenshots: compaction and queued review, a two-review loop, concurrency, unknown intervals, accessible ledger. No provider parsing in this round. |
| **CC5F — steering UI and capabilities** | New `commandCenter/model/capabilities.ts`, `ui/SteeringControls.tsx`; `src/features/files/ui/FilePicker.tsx`, `src/features/search/ui/SearchView.tsx`; their tests/fixtures | Use existing backend APIs; integrate after CC4 contract. Tests: exact target, each supported/refused action, provider live-steer capability, current versus next-turn model/effort, pending/error receipts, keyboard scope/search/palette focus and configurable shortcuts. Screenshots: palette, inline sheet, disabled unsupported actions and cancellation acknowledgement. Queued-task edit/named-member transfer stay disabled until G. |
| **CC5G — missing steering backend** | New orchestration action helpers/tests; only designated small action hooks in `src/features/orchestration/model/orchestration.ts`, `src/app/App.tsx`; needed host/native command owners explicitly allocated by coordinator | Serial shared-file window after CC2/CC4 and shell wiring; no parallel App/orchestration edits. Implement queued task edit and named-member transfer only. Tests: stale dispatch/dependencies/scope/reviewer independence, confirmed stop before replacement, preserved changes/approval ownership, rejected safety-bypass recovery, receipt and retry idempotence. Native/host checks where touched; isolated preview shows failure and success. No live provider turn without separately authorized brief. |
| **CC5I — shell integration and acceptance** | Coordinator-owned small navigation/action wiring in `src/app/App.tsx`, shell entry points (`ProjectRail.tsx`, after A hands off); feature exports and integration browser fixtures | Single integration owner, after feature exports stabilize. Preserve view exclusivity, back/escape, session/worktree navigation, explicit panel preferences and shortcut overrides. Cross-view tests and isolated screenshots of goal→attention→member→steer→timeline, reload and return-focus. Recheck CC4's current SHA/contract before wiring. |

Each builder owns a different test/fixture directory; existing test files remain with the associated component owner. Shared types come from CC4; only the integrator edits a common export index. A/B/C/D/E/F can run in parallel once shared contracts are stable, with App.tsx and orchestration.ts reserved for serial integration. C/D consume F's capability contract without creating a second execution path. This avoids assigning the same file to multiple rounds.

Every implementation round runs COMMON's full Vitest, TypeScript and build checks with `NODE_OPTIONS=--no-experimental-webstorage`, plus focused native/host checks if those layers change. It must produce screenshots from an isolated synthetic app preview, report actual counts/errors and stop its helpers. Static CC3 pictures are design references, not substitutes for implementation screenshots.

Cross-round accessibility acceptance: semantic headings and regions, full task names available on focus, non-color state text, contrast ≥4.5:1 for normal text and ≥3:1 for controls, visible focus, keyboard-only actions/resizing, labelled requests, focus restoration, reduced motion and 200% text zoom/390px reflow. Avoid per-second live-region chatter; announce meaningful state changes. The production palette needs actual dialog/combobox keyboard semantics and focus handling; the static palette is a labelled design section.

## Mockups and validation

Open [Mission control](cc3/mission-control.html), [Attention](cc3/attention.html), [Timeline](cc3/timeline.html), [Member](cc3/member.html) and [Steering](cc3/steering.html). They are local static HTML, share [monocode.css](cc3/monocode.css), and load no web fonts, CDN or app runtime. Navigation links and native disclosure work; operational controls are schematic and execute nothing.

The stylesheet snapshots the real Tailwind theme tokens and fonts from `src/styles/index.css:25`, `:117`, `:147`: background/content/stroke, selection strengths, accent/link/skill/diff colors and system sans/mono stacks. Layout uses plain CSS to keep the artifacts independently openable. Light attention text mixes the real skill/content tokens because the raw skill hue measures only 3.64:1 on the plain light background; original app tokens are not changed. Text labels accompany every state color.

All names, goals, request IDs, timings, tokens, costs and PR references in these pages are labelled synthetic. The metrics fixture uses Codex input semantics, with cached input included in input. The mission/timeline example excludes never-started Reviewer execution from its 179k-token/$1.93 illustrative roll-up. The review was dispatched at 22:22 and blocked at 23:06; at 32:24, blocked time is 9:18. Parallel lanes intentionally do not sum to goal wall time. Schematic costs are not model-price quotations.

Application validation on unchanged baseline, Windows/Node v26.5.0/npm 11.17.0:

| Check | Result |
| --- | --- |
| Worktree-local `npm ci` | Exit 0; 425 packages added, 426 audited; no manifest/lock edits |
| `npx vitest run` | **5,966 passed / 13 skipped / 0 failed**; **545 files passed / 2 skipped / 0 failed**; Vitest 44.91s |
| `npx tsc --noEmit` | Exit 0 |
| `npm run build` | Exit 0; 3,664 modules; Vite 52.65s |
| Native tests | Skipped: no native or app behavior changed |

Each subprocess used `NODE_OPTIONS=--no-experimental-webstorage`. Raw logs, command/env/timing receipts and source/data audit notes: `C:/Users/nooro/AppData/Local/Temp/monocode-cc/cc3/validation/`, `surface-audit.md`, `data-alignment.md`. The npm bootstrap reported existing audit findings and esbuild allow-scripts warning; the successful build retained baseline CSS `::highlight`, static/dynamic import and chunk-size advisories. No dependency repair was attempted in this design round.

Browser screenshots and their verification receipt are under [cc3/screenshots](cc3/screenshots/) and [browser-verification.json](cc3/browser-verification.json); [capture.mjs](cc3/capture.mjs) is the reproducible isolated capture/self-check. Browser results and visual inspection are recorded in the screenshot index and CC3 REPORT. These prove the mockups' rendering and measured checks only.

The capture matrix contains 14 Chromium cases: all five views in dark/light at 1440×1100, Mission control/Member/Steering at 390×1000, and Mission control at 900×1000. It checks structure, local resources, overflow, native keyboard focus/disclosure, inert operational buttons, reduced motion, sampled attention-text contrast and source stability. The final receipt passed all **219 checks, with 0 failures**, and verified browser/server closure and temporary-profile absence. The minimum sampled attention-text contrast was **4.73:1**; all screenshots and HTML/CSS hashes matched the final files. Windows profile removal uses bounded filesystem retries; cleanup failure is reported as failure. Light contrast and the narrow branch layout were corrected after browser inspection. Full screen-reader/WCAG and implemented palette keyboard behavior remain future implementation acceptance.

## Risks, follow-ups and deliberate omissions

CC4's committed contract at `32b62c5` is the integration foundation; recheck it before implementation. Full model-call phase timing or cost can be unsupported even after CC4, so unavailable/partial states are essential. Historical latest-request Codex samples remain insufficient for complete spend. Provider cache semantics and overlapping per-goal report turns require careful display/global aggregation. General nested delegation ancestry, queued-task edits and different-member transfers still need explicit backend support. View changes must preserve worker→lead approval routing, exact review validity and cancelled work.

The mockups show the required core views and shared sidebar/panels. They do not replace Notes, Automations, Team map or search content screens, implement backend actions, perform repair, launch a native app, submit a model turn, mutate user data, merge, push, publish or deploy. CC3's screenshots must not be reported as native desktop or live-provider acceptance.
