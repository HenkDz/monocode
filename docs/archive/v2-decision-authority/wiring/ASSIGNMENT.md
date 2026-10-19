# V2 decision UI, runtime authority and reviewed repair follow-ups

Read COMMON/OPERATING-MODEL, ccvision/BRIEF.md/PLAN.md, the foundation CONTRACT,
CLAUDE-REPORT and final REPORT. Root supplies the accepted merged foundation pin
before launch. Approved prototypes already have user approval; no mockup gate.
This stage needs existing Claude review of persistence/host authority and a fresh
independent UI/runtime review before integration. No fanout for this scope.

Begin independent work while V1 corrections finish. You own decision components,
ledger follow-ups, runtime/crew-event adapters and decision prompt rules. V1 owns
App/Sidebar/TitleBar/SessionPane/WorkspaceContext and shell fixtures; V3 will own
OrbitMap/TeamMap. Do not edit these shared files before root's explicit accepted
V1 handoff. Keep their small integration changes in an external pending patch;
do not claim unwired adapters as functioning product behavior. Final freeze and
full gates require the accepted V1 base and actual production wiring.

Reuse the existing team.message kinds, goal ledger, CC5D receipts and CC-GOAL
authority. No parallel bus/store/queue. Wire real authenticated sender/actor and
original committed request/goal/account/home/session/generation/task/dispatch;
text never supplies authority. Use the shared bossMayDecide rule in runtime and
prompt instructions. Resolve through one originating Manager record, route to
the actual Manager/Boss/user level, and deliver authoritative answers back along
the original chain exactly once. Stale/cancelled/replaced context is recorded but
never delivered as work authority; pending decisions do not freeze the team.
Reminders to recipient user map to UI notification, never a fabricated Mono.

Complete Claude's two reviewed P2s: autonomy must validate Manager/project roster
membership and work without any active goal; unreadable decision history needs
minimal safe quarantine/repair with visible state and preserved raw evidence,
keeping unrelated goals/receipts intact and invalid decision authority closed.
Choose the simplest correct repair strategy and submit its actual contract to
existing Claude early. Do not drop corruption, replace the ledger with defaults,
overwrite newer updates or weaken the existing capacities/serialization guards.

Build the Decisions page/log and reusable decision cards/rail data matching the
approved prototype: real chain, impact, question/context/options/recommendation,
Open project, Let Boss decide and team-decided-today count. Show honest empty or
unavailable state. Reuse existing attention/auth/approval components where useful;
preserve deduped sign-in cards, exact raw approval commands and held-intent guards.
Untrusted text stays plain text, bounded and out of telemetry. Autonomy settings
cannot authorize merge/install/sign-in/destructive/system-default/spend actions.
Decisions do not execute these operations; their existing explicit user gates
remain, with real approval-card integration reserved for V4. No silent effects.

Prove actual UI-to-host, authenticated team route, serialized save/reload, receipt
and consumer behavior. Include duplicate/restart/failed-save, stale account/home/
project/goal/generation/dispatch, approval/Stop/cancellation and awaited mutation
cases; do not use fabricated committed user blocks or handwired-only callbacks
as the sole proof. Cover no-goal autonomy and corrupt-record repair preservation.
Preserve raw failures/skips/deadlines and all previous guards. Data/UI foundations
without production hooks are partial scope and cannot pass final wiring review.

Final gates: focused connected checks, browser frames against prototypes with
dark/light/narrow and keyboard/focus checks, tsc/build, full Vitest workers1 before
integration; plain unpatched cargo test --lib only if native changes become
necessary (avoid them if existing IPC suffices). No heavy grant initially: use
source-only preparation until root assigns a released slot, fresh >=3GiB EACH
heavy start, max2 streams. No provider turns, real profile/private-home/credential
reads or writes, app control, push/deploy or nour mutation. Synthetic state only.

Publish early CONTRACT/CLAUDE-REQUEST, durable CHECKPOINT and final REPORT/manifest
under this packet, exact source pin and actual/inherited evidence. Root alone
coordinates shared files, final Claude review, independent UI review, separate
release preparation and integration. Do not stop for an inferred approval while
independent authorized work remains; ask root only for a concrete missing input.
