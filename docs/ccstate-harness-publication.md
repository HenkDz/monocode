# CC-STATE: pending updates at harness publication

The App HarnessEventQueue callback synchronously computes the delivered batch,
publishes sessionsRef, and updates the dock badge before scheduling React state.
Previously that state update replaced the entire array. A queue scheduler's
pending asynchronous rejection pause, or a pending queue edit, could disappear.

Keep the synchronous ordering and publish through a functional setter. Reuse the
computed array when React still has the original array; otherwise apply the same
batch to React's latest sessions. Pending target and sibling updates survive,
removed sessions stay removed, and the existing foreground/background cadence is
unchanged. There is no synchronous React flush in delivery: foreground delivery
also runs inside App's layout effect.

Replays share lazy UUID/time values per session and original event index.
Turn-metric and turn-end clock reads stay distinct. Skipping an allocation,
removing/reordering a session or replaying in StrictMode cannot shift another
event's generated identity. Caches belong only to the captured delivery batch;
ordinary reducer calls without a replay cache retain their existing defaults.

Only the App publication callback, event reducer and connected tests change. No other caller, export,
fixture outside the new regression, config, dependency, UI or native change is
needed. Receipt, generation and authority checks stay at their existing callers.
Usage retained repair and manual controls remain unchanged.

The new regression executes actual App AST callbacks and the queue scheduler,
real React setters (including StrictMode), actual HarnessEventQueue and event
reducers, and real JS session writes/reload with synthetic native transport.
It covers same/sibling/combined rejection orderings with no-delivery controls,
multiple batches, exact receipt IDs, Stop/generation, removal and layout delivery.
Generated block IDs and timestamps are also compared between synchronous ref
snapshots and committed state, including changed allocation paths across replays.
Durable reload uses explicit JS upsert/read; this is not native filesystem or
installed-App autosave acceptance.

Raw before/after logs, exact frozen commit/tree, final connected/full/type/build
counts, failures and cleanup are maintained in the external CC-STATE packet:
`C:/Users/nooro/AppData/Local/Temp/monocode-cc/ccstate/REPORT.md`.
The inherited two expected-safe assertions are retained unchanged in that packet.
Existing Claude reviews the boundary through root; root alone integrates nour.
