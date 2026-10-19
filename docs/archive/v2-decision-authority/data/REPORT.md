# V2 decision data foundation - frozen candidate ready

Candidate HEAD `f31f4288ed06c0227629c110e0df1ccf9af71d37`, tree `d5c0d7b993dfd532fb6e9308294cdb05abe85fcc`; exact accepted base `8232734e6e992214ca1538e29ffa6d8270fa8a20`. Three source/test paths changed, 781 insertions; clean frozen candidate and SHA256 manifest in `final-manifest.json`. Root alone integrates.

## Delivered

Existing `MonoManagerGoals` ledger now retains optional decision history, project autonomy, versioned receipts and a compact pruned-history count. Structured question/escalation JSON uses the existing `team.message.text` contract. One originating Manager owns each decision; actual reporting relationships and the original CC-GOAL user/goal/project/account/home/session/generation/task/dispatch binding govern every action. Authenticated current-level actors resolve/escalate, the user may delegate work decisions to the Boss, and the shared `bossMayDecide` helper enforces autonomy and protected classes. Impact only rises; reminders are explicit logged actions. Pending decisions do not pause workers or auto-approve.

Return events follow the original chain through existing ledger receipt outboxes and CC5D stable event IDs. Save-before-delivery and post-await validation preserve failed-save, duplicate, restart and cancellation guards. Stale answers remain recorded without work authority; temporary context lookup failures preserve retryable deliveries. History keeps pending records and the last 200 fully delivered resolved decisions, with receipt tombstones retained and existing 7MB/4,000-receipt capacity failures preserved.

## Actual checks at frozen source

| Check | Result |
| --- | --- |
| Focused six-file authority/receipt/store set | **189 passed, 0 failed**, including **58 decision tests** |
| `tsc --noEmit` | **exit 0**, no diagnostics |
| `npm run build` | **exit 0**, Vite built in 1m27s |
| Full Vitest, `--maxWorkers=1` | **exit 0: 9,346 passed, 0 failed, 13 skipped; 691 passed files + 2 skipped files** |
| Source manifest | exact HEAD/tree, clean status and exactly three owned paths verified |

All heavy starts used fresh available RAM >=3GiB and one sequential stream; see `ram-gates.log` and `gate-results.log`. Full-suite duration: **1,693.37 seconds**. All **58/58 decision tests** also passed in the full run. The 13 exact skips are preserved by name in `gate-summary.json` and `full.json`: three `antigravityReal` cases and ten `antigravitySoak` cases; those test files are unchanged from the exact base. No inherited historical failing result is relabeled by this new actual green run.

Full-suite parent and actual tinypool-fork startup records in `full-child-environment.jsonl` prove process-local `--no-experimental-webstorage`, Node v26.5.0 and absent experimental localStorage: **696 recorded processes, including 694 tinypool startup receipts**. The external recorder asserts the flag and only writes environment receipts; it changes no source/test assertions.

Raw initial install/focused harness failures, expected negative-test stderr, build warnings and unsuccessful reporting-command attempts are retained in `HARNESS-FAILURES.md` and their logs. Earlier actual focused 185/0 and tsc0 precede the final freeze and remain separately retained. Build warnings include unsupported `::highlight` CSS pseudo-elements and chunks above 500kB; no build warning was repaired or suppressed.

## Persistence/native boundary and evidence limits

**Persistence changes:** optional decision/autonomy fields and decision delivery entries extend the existing version-1 `mono-goals:<Manager>` JSON ledger and its serialized `control_save`/`control_load` writer. Existing goals, receipts, events, unknown ledger values and absent-field defaults remain intact; present malformed decision data fails closed without overwriting history. No parallel database, bus, queue or CLI opcode.

**Native changes: none.** No Rust/schema/registration/session-loader/transcript/CC0 path changed, so the conditional plain cargo gate was not triggered. The durability test executes the production frontend adapter against a synthetic disk SQLite boundary, closes/reopens the database and hydrates a fresh production ledger. It proves frontend serialization and real synthetic disk save/load, **not execution of Rust IPC/native storage, profile or provider acceptance**. No app launch/browser frames were needed for this data-only scope; runtime/UI/agent-prompt wiring and installed-app acceptance are later stages.

Claude read the exact final source and **CLEARED this foundation for integration**, conditional on green final gates; those gates have now passed at the same exact pin. See `CLAUDE-REPORT.md` and the eight-requirement test mapping in `CLAUDE-REQUEST.md`. Root expressly assigned the two nonblocking P2s to V2 UI/wiring: roster validation must allow autonomy changes with no active goal, and invalid decision history needs quarantine/repair UX while preserving data. P3 limits: self-declared operation classifications never replace real merge/install/sign-in approvals; recipient `user` maps to UI notifications. Later hosts must use authenticated actor identity, specific original retained context, durable exact CC5D receipts, supplied publication validators and all existing consumption/approval/Stop guards. Text remains untrusted plain strings for text-node rendering, never executable HTML or telemetry.

## Handoff and release

All owned validation sessions exited. `cleanup.json` verifies **zero recorded owned Node processes still running**, with no process stopped; the final manifest recheck verifies the same clean exact HEAD/tree and three-file boundary after all gates. **FULL B RELEASED, zero owned heavy jobs**, reported to root as `msg_d15857f4a9dc`; no further heavy starts planned.

Root owns separate release preparation and sole integration. Future runtime/UI/prompt wiring must address the reviewed P2s and host obligations above, and native/provider/installed acceptance remains unproven. No push, app launch or nour mutation performed.
