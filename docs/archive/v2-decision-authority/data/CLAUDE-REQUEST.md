# Exact V2 data candidate review request

HEAD `f31f4288ed06c0227629c110e0df1ccf9af71d37`
Tree `d5c0d7b993dfd532fb6e9308294cdb05abe85fcc`
Base `8232734e6e992214ca1538e29ffa6d8270fa8a20`
Worktree `C:/Users/nooro/orca/workspaces/monocode/ccvision-v2-decisions-data`

Three changed paths only: `src/features/monos/model/monoDecisions.ts`, `monoDecisions.test.ts`, `monoManagerGoals.ts`. No native/schema/registration/prompt/App/shell/sidebar/workspace/SessionPane change. Source frozen. Final focused 189/0 (58 decision tests, 6 files); final tsc/build/full pending as of initial request, REPORT/CHECKPOINT will record actual terminal results.

Review the existing Claude contract requirements against these test names in `monoDecisions.test.ts`:

1. Single authoritative originating Manager ledger: `uses one Manager ledger...`, `keeps the decision at the Manager even when...Boss`, `serializes concurrent Boss/user actions...`. Host reads original retained CC-GOAL and passes explicit pending-cancel flag; other levels use ID/version. Same existing serial writer.
2. Trusted answer source: parameterized `rejects a worker's forged answer field`, `refuses decision-kind answer ingestion and a Manager impersonating the Boss`. Authenticated `DecisionHost.actor` is copied before serialized async work. Strict question/escalation JSON rejects status/answer/decider fields. Runtime CLI/user handler wiring remains later V2 scope.
3. Impact floor and protected classes: `keeps low-impact %s explicitly user-owned`, `persists project autonomy...retains impact floors`, `rejects immutable operation corruption and impact lowering...`. Merge/install/sign-in/destructive/system-settings/spend require user. Decisions execute no operations.
4. Bounded history: `caps resolved history at 200...` tests final acknowledgment pruning as well as pending retention and count; `refuses oversized saves...` verifies the existing 7MB cap retains prior state. Existing 4,000 receipt cap remains; compact receipt tombstones retained.
5. Exactly once/stale answer: `replays durable receipt after a failed acknowledgment...`, `records a trusted stale user answer...`, parameterized `refuses stale %s authority...`, awaited-save/delivery race tests and `preserves retryable deliveries...`. Versioned event IDs use existing `addManagerWakeEvent` dedupe; outbox stays in existing ledger receipts. Host must save/read exact CC5D receipts and recheck validator before publication; actual App/native/provider delivery is not claimed.
6. Pending/reminders: `records reminders without auto-deciding or pausing the team...`. No scheduler, timeout approval, or worker pause is introduced; Boss reminders are explicit logged actions.
7. Explicit Boss rule: shared `bossMayDecide`, parameterized `shares the explicit Boss policy...`, and Manager/Boss/user resolution cases. Later prompts must consume this helper; no prompt edits here.
8. Hygiene: malformed/oversize/classification cases; `retains context/options as untrusted text without execution or telemetry`. Caps 300/2000/6 options/240 per label/6000 message. Plain strings retained unchanged for React text-node rendering; no HTML renderer or telemetry exists in this foundation.

Persistence proof: `round-trips the production control_save/control_load adapter through a synthetic disk SQLite database` closes/reopens the file database and reloads a fresh production ledger instance. This exercises real frontend adapter/serialization but substitutes the Rust IPC boundary, so it is not native-storage acceptance. No native changes therefore no cargo gate triggered; CC0 stores/session loaders are untouched.

Please return an exact HEAD/tree verdict and concrete corrections if any. Integration remains HELD until your final clearance; root is sole integrator.

Terminal update: exact source cleared in `CLAUDE-REPORT.md`; final focused189/0, tsc0/build0 and full9346/0/13skips all passed at the unchanged pin. Final manifest clean/exact; FULL B released with zero owned heavy jobs. The two P2s remain explicitly assigned by root to later V2 UI/wiring.
