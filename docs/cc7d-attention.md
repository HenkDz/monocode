# CC7D: Attention queue

Attention adds one destination for the work waiting on the user. It lists
permission requests, structured questions, account storage and usage blockers,
storage preparation, failed deliveries, failed task attempts, CI repairs and
the last failed automation run. Open, Approvals, Decisions, Blockers, Failures
and History filters keep these sources reachable. Blockers lead, followed by
the oldest recorded request; missing ages remain unavailable.

The starting application commit is `e950866bb164ded1eba3cbcd5632279a8fd313c8`.
Work stays on `HenkDz/cc7d-attention`. The coordinator owns review and integration.

## Sources and ownership

`model/attention.ts` projects existing sessions, the roster, goal ledger and
orchestration runs. It uses CC4's canonical live-state selector, Activity's
`teamDecisions`, CC0's account issue grouping, Inbox's tracked CI repairs and
the existing automation list/subscription. It adds no provider event parser,
database migration, mutation transport or dependency.

Identity includes the owning session/provider conversation and original block
or turn/request identity. Task failures retain task and dispatch IDs. A shared
storage account becomes one item containing all affected conversations and
linked goal titles. Membership and command arguments participate in freshness
checks, so an old action cannot silently target a replacement. Remote storage
issues remain visible but cannot invoke local repair, comparison or reveal.

Workers continue to report to their lead. Session, saved dispatch and roster
ownership all prevent worker approval/answer controls. Escalation is the lead's
new native request; it becomes a separate user-owned item. Existing
`onOpenApprovalSession` resolves a worker identity to its owning lead. Individual
task retries need a lead scope decision, so the queue opens that decision with
**Review retry with lead** instead of inventing a task retry callback.

## Actions and history

Inline actions reuse the shell's exact approval, question, storage recovery,
usage resume/schedule, queue retry and Manager continuation callbacks.
`QuestionForm`, `MonoCodexStorageNotice` and `UsageLimitNotice` remain the real
installed controls. Structured option IDs, custom answers, multiple questions,
partial skips and optional-question interaction are preserved. Storage version
choices, comparison, preserved-file details and errors remain CC0-owned.

Every mutation rechecks current sources before dispatch. Pending actions disable
duplicates. Void callbacks produce **submitted, awaiting source acknowledgement**,
not a claim of provider delivery. Failed actions preserve their item and error.
Delivery retry operates only on a paused user outbox's exact retained head, with
storage, usage, editing and sending guards; failed internal app events remain
inspectable through their original conversation.

Resolved approvals come from saved source decisions. Answer, repair, usage and
continuation history needs a matching successful submission and affirmative
cleared-source evidence. Missing sessions or changed providers cannot establish
resolution. Changed requests and replaced task attempts remain inspectable in
History with actions disabled. Fast source acknowledgement before the callback
settles is covered by rendered regression tests. History also retains a prior
storage conflict when its same account identity receives new evidence.

## Marked shell integration

The hook is confined to `App.tsx`, `shell/Sidebar.tsx` and the optional banner
callback in `MissionControl.tsx`. The reserved `command-center:attention` scope
shares Team map's full-view lifecycle: Back/Escape, view exclusivity and existing
conversation navigation. Sidebar exposes expanded, compact and project-picker
entries. Mission control's existing attention banner opens the queue; its
existing goal-scoped count and wording are retained for CC7P compatibility.
No Inbox view, GoalChain, agent UI or orchestration implementation is edited.
The existing approval-navigation callback now returns its original navigation
promise, so failed opens reach the queue's receipt without changing routing.

The view uses the app's theme tokens, native buttons/disclosures, labelled
regions and existing accessible question fields. It wraps at 390 px, supports
keyboard actions and 200% text zoom, and stops its age timer while hidden.
Only the visible queue claims Escape before the shell's Stop handler.

## Validation and evidence

The full Windows / Node 26.5.0 checks use
`NODE_OPTIONS=--no-experimental-webstorage` and a four-worker full-suite cap.

| Check | Final result |
| --- | --- |
| Full Vitest | 570 files passed, 2 skipped, 0 failed; 6,514 tests passed, 13 skipped, 0 failed, 0 todo; 572 files / 6,527 tests total |
| Focused model / rendered UI | 66 / 21 passed, 0 failed or skipped |
| `npx tsc --noEmit` | Passed, exit 0 |
| `npm run build` | Passed, exit 0 |
| `git diff --check` and staged diff check | Passed |
| Focused Cargo | Not required: native and host files unchanged |

Final full-suite command time is 95.483 seconds; TypeScript 13.877 seconds and
build 29.618 seconds. The 13 skips are the two existing Antigravity real-provider
and soak suites. Build retains the existing two CSS `::highlight` warnings and
large-chunk advisory. All 1,307 captured source/config hashes match before and
after final validation. Earlier checks do not contribute to these totals.

Focused acceptance includes 66 model tests and 21 rendered UI tests. The isolated
Chromium harness passes 14 checks and captures 24 screenshots: approvals,
decisions, storage/usage blockers, failures, action pending and action error,
each in dark/light at 1440 px and dark/light at 390 px. The harness uses real
controls and synthetic callbacks, an empty temporary launch directory, an
isolated fixture identifier and temporary browser contexts. `CODEX_HOME` and
every `ORCA_*` variable are removed; its preview port is closed after checks.

Evidence root:
`C:/Users/nooro/AppData/Local/Temp/monocode-cc/cc7d/evidence/`.
See `attention-model-vitest.json`, `ui-vitest.log`, `browser-report.md`,
`browser-results.json`, `browser-launch.json`, `browser-shutdown.txt`,
`screenshots/`, `validate.ps1`, `validation-summary.json` and
`validation-20261011-153550-159/` (raw JSON/logs, exit/time receipts and hashes).
The initial browser history-race failure and earlier model-contract regression
run are retained as superseded evidence, not final acceptance.

## Limits and alternatives

The queue covers loaded conversations, saved runs and existing failure stores;
it does not load every historical transcript. Question history observed during
this app mount has no new persistence layer. Saved decided approvals, previous
failed dispatches and CI history remain available from their original stores.
Automation coverage is the existing last-run snapshot, not an additional history
poller. There is no shared durable registry for local dialog/background-operation
errors, so those stay in their original operation UI.

Model/account changes remain in the existing conversation reached by the usage
item. Automation and CI retry decisions open their original views/conversations
because their existing retry paths create new scoped work. New global polling,
bulk approval, automatic merge/destructive recovery, a second storage choice UI
and an independent shell navigation state were rejected. No real profile, live
provider turn or native window was exercised; harness acceptance proves the
rendered UI and callback contracts, not provider/native behavior.
