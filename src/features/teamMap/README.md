# Team map

The [R17 layout verification](r17-verification.md) records compact team pods, adaptive layout, semantic zoom and focus, with before/after screenshots and live browser checks.

The [R17 layout report](r17-verification.md) records compact teammate grids, viewport-based pod wrapping and orientation, semantic zoom, focused teams, and before/after evidence.

The [R15 polish report](../../../docs/r15-polish.md) covers the full main-area view, readable fit, scoped filter, grouped newest-first feed, direction hints and acknowledgement delivery. R14 implementation and native evidence follow.

The map reads the existing Mono roster, R12 availability, orchestration task lifecycle, Manager goals and crew feed. Managers own compact teammate grids; pods wrap and choose an orientation against the viewport on resize. Below 70% zoom cards show mascot, name and status; full details return above that threshold. Click a Manager or project label to focus its pod, use its Open chat action for chat, and return with Whole org or Escape. Idle teams can collapse into an expandable summary. Project and Needs you filters, tooltips, keyboard exploration and the recent-event strip remain available. Narrow windows use the same hierarchy as a vertical list.

The canvas uses HTML cards and SVG edges with deterministic pod layout and shared trunk-and-branch routes. This org has a fixed hierarchy and no graph editing, so native pointer handling, CSS transforms and SVG motion avoid adding a graph-library dependency. Delegation and report pulses use the same routed paths and start only when subscribed state emits a new event; opening the view or changing filters does not replay history. Reduced motion replaces travel with static edge indicators and disables status-ring and layout motion. Fit uses padded bounds without clipping nodes to force a minimum zoom.

Reporting lines also show a continuous dashed tread while work is active: queued assignments flow downward, and working progress flows upward from members through their Manager to the Orchestrator. Shared availability stops waiting, blocked and finished work; a blocked sibling does not interrupt another teammate's active reporting chain. Collapsed teams keep their upstream activity line. Reduced motion keeps the active lines dashed and static, and Needs you dims unrelated lines along with their nodes.

`model.ts` contains layout, status, event routing and keyboard derivations. `TeamMap.tsx` renders the view and subscribes to roster, crew messages and Manager goals; App supplies live sessions, runs and PR states. Stored goals identify Manager engines, so event routes resolve those engines to durable Mono IDs before drawing edges.

App and Sidebar contain entry-point wiring only. Existing Mono cards, Details, Activity and sidebar groups are untouched. Opening a Manager's map scopes it to that Manager and descendants; map actions navigate or change this view, without changing team membership or task authority.

The focused tests cover layout, shared availability/PR readiness, stored engine IDs, dispatch/report/review/goal routing, reduced motion, project and Manager scope, collapsed teams, stale keyboard focus, narrow list navigation, zoom and real store subscriptions. Native acceptance and screenshot evidence are recorded in `verification.md`.

Earlier R14 frontend verification: 20 focused tests passed; the full suite passed 5,284 tests in 497 files (13 tests and 2 files skipped). TypeScript and `npm run build` passed. On Node 26, tests use `NODE_OPTIONS=--no-experimental-webstorage`; the full run used four workers to keep integration checks within their existing time limits. Current R17 results are in the layout report above.

Optional drag reassignment is omitted. Existing approval, review and merge behavior remains owned by the app's original orchestration paths.
