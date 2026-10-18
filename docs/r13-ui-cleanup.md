# R13 UI cleanup

Branch: `HenkDz/r13-ui-cleanup`; baseline: `465c6862b1451ec49618fdd56002db8b1a09f8d6`.

Chat cards now summarize task, PR, team and dispatch state with an Open action. Long assignments, reports, reviews, editable proposals and tool output use the existing dialog or artifact reader. Details uses the existing settings rows and navigable pages. Activity uses Needs you, Working, Ready, Finished and Feed tabs with counts, flat rows and subtle dividers. The first nonempty tab opens by default, prioritizing decisions; choosing a tab keeps that selection.

No backend lifecycle, permissions, approval authority, persistence or team-message writer changes. Lifecycle labels continue to use `managerTaskLifecycle`, availability uses `monoLiveState`, and artifact chips open R9's reader. No `src/app/App.tsx` or `src/features/teamMap/**` changes. Local commit only; no push.

## Inventory and decisions

The inventory includes native details, disclosure buttons, expanded content and nested card frames. Ordinary action popovers and editable forms remain usable; they are not content accordions.

| Surface | Before | R13 decision |
| --- | --- | --- |
| Activity task rows (`MonoTeamActivity`) | Per-task Details plus Show more; bordered task cards nested beneath project/goal/section groups | Two summary lines: mascot/status/title/Open, then owner/latest event/time. Open routes to the worker chat or the historically anchored Manager PR card. Remove inline assignments and nested goal borders. |
| Activity Finished section | Native details for each project's finished group | Counted Finished tab; flat finished rows. |
| Activity project/goal groups | Repeated status headings under goal headings and a left border | Project heading with counted flat sections; no extra goal card. Unassigned goals remain visible under Working. |
| Activity approvals/questions/resume | Amber decision card inside a bordered task card | Keep decisions actionable in Needs you; a single subtle left accent replaces the extra box. Preserve request IDs, answer forms, continue errors and callbacks. |
| Team-at-work nodes (`MonoOrgActivity`) | Recursive hierarchy with nested left borders; per-node Tasks and Live activity details | Flat teammate list with availability, current/latest task and one Show work action. The full chronological tool trail opens in the existing dialog. Names and events have full-text tooltips. |
| Crew feed | Native details with a long list | Counted Feed tab and flat one-line events; document title chips remain clickable. Retain chronological ordering, event deduplication, stored teammate messages and the existing latest-40 window. |
| Sidebar Task worktrees | Collapsible header, extra guide border around task group | Retain persisted collapse and count using the quiet sidebar header; remove group guide border. |
| Sidebar Finished worktrees | Secondary collapsible group | Keep a matching quiet full-width header, count and persisted collapse. No nested card or new persistence source. |
| Sidebar sessions/team/project groups (`ProjectManagerRow`, `OrchestrationSidebarAgents`) | Existing tree/group expansion | Retain normal sidebar collapse and navigation; not a chat content accordion. |
| Projects Add (`MonoProjects`) | Add action toggles an editable picker | Retain as an action form; no static-content disclosure. |
| Habit detail/editor (`HabitPage`) | Schedule/action detail controls | Retain editing, schedule validation and the dedicated page. |
| Account choice (`MonoUsageLimitNotice`) | Expanded account menu | Retain keyboard account selection; unrelated to stacked content accordions. |
| Generic transcript command output and tool/subagent payloads (`AgentTranscript`) | Existing transcript tool viewers, native command-output details and payload expanders | Retain generic chat viewers. Mono work readers opt into complete flat notes/output with no nested failed-output or long-note disclosure. Pending approvals retain their existing actionable renderer. |
| Model, effort, permissions and worker pickers | Action menus/popovers | Retain keyboard behavior, validation and existing controls. |
| Artifact containers | R12 title chips, occasionally extra surrounding card body | Keep the title chips and existing artifact-reader route; no new card around the links. |

## Accessibility and themes

Tabs have counted labels, a tablist/tabpanel relationship, roving tab stops, Left/Right wrap and Home/End. Covered pages remain inert through PanelStack; subpages keep Back. Dialogs trap Tab, return focus to the actual opener, and apply Escape only to the topmost dialog while allowing dialog popovers to handle keys. Existing reduced-motion behavior is retained; no new animation was introduced. Status chips include text and use the existing lifecycle colors. New flat Activity summaries use ellipsis and tooltips for long content.

## Verification

Focused coverage includes summary Open actions, assignments/reports/review/Undo/send-back/proposal flows in dialogs, artifact routing, counted keyboard tabs, no inline task details, Show work, Settings subpages and Back, live reader updates, pending approvals, shared dialog focus behavior, sidebar persistence and cross-surface lifecycle/availability. Independent audit found and corrected a newest-task regression in org summaries; a completed task with a pending approval now remains Needs you.

The full frontend run passed 5,270 tests; 13 provider tests were skipped (496 files passed, 2 skipped). After the last narrow-width and navigation fixes, every changed/new test file passed again: 104 tests across 15 files. Cross-surface lifecycle and availability tests also passed. The test worker used `NODE_OPTIONS=--no-experimental-webstorage` for Node 26 and two workers to avoid the resource contention seen in the first run. The first run's connected accordion/navigation mock assertions were updated; load-sensitive file-editor tests passed independently and in the full rerun.

Final TypeScript and production build checks use the frozen source. Existing CSS optimizer and large-chunk warnings remain in the build log. No dependency or lockfile changes.

The [visual evidence report](r13-visual-evidence.md) links before/after screenshots in both themes at 900px and 390px, plus readers, Details subpages, Activity tabs, keyboard interactions and reduced-motion evidence. Screenshots use actual source components and theme styles with mocked backend/store data in an isolated browser fixture; they establish rendered frontend behavior, not a native desktop or live-team acceptance run. Local screenshots, hash receipts and full test/build logs remain under ignored `target/`.

Final review caught and fixed parked card dialogs obscuring internal destinations: worker/worktree navigation, Team editing and document actions now dismiss their owning dialog without altering operation drafts/errors. Work-reader document links do the same; approvals in the org work reader route the original worker session and request IDs to the existing handler. Screenshot review also found the inherited percentage width cap shrinking Details to 156px at a 390px viewport. Details and artifact panels now keep their existing minimum widths when they fit, and cap width to the viewport on smaller screens; three rendered-width tests cover narrow and desktop widths.


## card audit

Scope: `MemberWorkLog`, `ProjectManagerReview`/`ReadyCard`, `MonoTeamChangeCard`, `MonoChatCard`, `OrchestrationPreview`, and their artifact links. Callers inspected in `SessionPane`, `AgentTranscript`, and `MonoChatCard`; public props and navigation callbacks remain compatible. No `App.tsx` or Team map changes.

| Surface                        | Before                                                                                                 | Decision                                                                                                                                                                                                                                   |
| ------------------------------ | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Member task                    | Disclosure triangle and expanded task body; nested Assignment details; report Markdown inline          | One compact summary with lifecycle chip, title, Manager mascot, PR, documents, time and Open. Assignment/report/worktree/session/PR actions move to the existing shared dialog. Needs you stays highlighted without opening automatically. |
| PR-ready / historical PR       | Tall bordered card with branch/provider/timeline/review body; Manager's review details; bordered chips | Compact status/title/owner and PR/diff/check/document chips with Open. Timeline/review and PR/diff/send-back/remove-worktree actions move to dialog; Next stays available on the summary for keyboard review navigation.                   |
| Team hired / updated           | Member bodies in chat; Soul details; Undo and Edit actions                                             | Compact title/count, member mascots/names, Team plan document and Open. Soul, model warnings, receipt errors, Edit and Undo move to a flat dialog list with subtle dividers.                                                               |
| Orchestrator dispatch / status | Already flat goal rows, one outer border                                                               | Keep flat rows; use Manager mascot, consistent chips and Open routing to the Manager session. No additional disclosure.                                                                                                                    |
| Orchestrator ready             | Shared ReadyCard                                                                                       | Same compact PR summary and dialog.                                                                                                                                                                                                        |
| Orchestration proposal         | Collapsible per-task instructions and Show more tasks; model/worker controls nested in transcript      | Compact title/status/lead/count and Open. All editable assignments and confirmation remain in a flat dialog; model/effort popovers retain their keyboard interaction.                                                                      |
| Artifact links                 | R12 title chips opening R9's artifact reader                                                           | Keep existing chips/reader route; no extra container borders. Links remain visible on summaries and useful inside dialogs.                                                                                                                 |

The shared dialog now traps Tab at its bounds, restores trigger focus on close, and applies Escape only to the topmost dialog. Dialog-owned popovers retain their own keyboard handling. No animations added. The lifecycle, matching-dispatch review evidence, verified merged evidence, document routing, error handling, and existing action callbacks are retained.

Checks: focused card, proposal-flow and dialog keyboard tests. Screenshot/theme/width and full-suite evidence are collected by the root verification worker.


## Details and work-reader audit

| Surface | Existing disclosure / card | Decision |
| --- | --- | --- |
| `MonoDetails` settings | No accordion; `Property` rows already order Model, Reasoning, Service Tier, Permissions, Projects | Keep the existing controls and order. |
| `MemberDetails` settings | No accordion; Model, Reasoning, Service Tier, Permissions, Specialty | Keep profile locks, validation, permissions and R12 task lifecycle. |
| `MonoSettingsPage` navigation | Soul, Memory, Habits and Team/Managers already open dedicated pages | Reuse pages and Back buttons; organize rows Soul, Memory, Habits, Team. Add explicit accessible row names, ellipsis and description tooltips. |
| `MonoDetails` organization Activity | `<details>` around “This agent's tool activity” below the team view | Replace with one Show work button opening a panel subpage with Back. Preserve externally requested tool activity navigation. |
| `MonoActivityContent` | Inline full tool timeline, including long-note and failed-output disclosures | Show status summary and one Show work action opening the existing Modal reader. Keep pending approvals actionable outside the reader. |
| `MonoActivityTrail` inside the work reader | Failed tool output used nested chevrons; completed output had no dedicated reader access | Opt-in `readOutput` renders complete note text and tool output openly; existing chat rendering remains the default. Preserve tool/file links, delegated session actions and approval handlers. |
| `MonoTeamPage` | Flat member list plus separated hiring form; no accordion or nested card | Keep existing hiring/retirement authority and validation. Add full-text tooltips and named removal actions. |
| `MemberDetails` recent tasks | Flat buttons to worker chats; no accordion | Keep lifecycle source and chat navigation; add task title tooltips and stable status widths. |
| Soul | Dedicated page, source editor and existing conflict/error controls; no accordion | Retain editor and page structure. |
| Memory | Flat fact list and editor, budget footer; no accordion | Retain concurrent-edit safeguards and fact actions; expose truncated facts through tooltips. |
| Habits / Habit / NewHabit | Dedicated pages, flat habit rows and section dividers; no accordion or nested card | Retain run/pause/remove and schedule validation; expose truncated names/schedules through tooltips. |

All new controls use existing tokens and native buttons. PanelStack already makes covered pages inert, and its transitions respect reduced motion. Work dialogs reuse the existing Modal accessibility behavior.

Focused checks: Details settings order and permissions; member settings; Soul/Memory/Habits/Team navigation and Back; one work reader showing successful and failed command output without nested error disclosures; pending approval actions; unchanged chat error-disclosure and inline approval behavior.
