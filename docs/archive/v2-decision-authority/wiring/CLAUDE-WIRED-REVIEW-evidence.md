# Claude wired authority/persistence review: candidate `c993d69`

- **Exact pin:** `c993d6912c5902e7f2692153371d06f7417a80cf`, tree `ac6f35a7de51ba422b1cb61ace9ee69dcc0556e1`, in the clean detached checkout `v2wire-review`.
- **Base:** accepted V1 `0e95c375`. The diff covers 33 files (+2363/−116). I read all of the authority, persistence, runtime and UI-action source.
- **Scope:** read-only. I made no edits.

**Verdict: FIX-FIRST.** There are 2 P1s, 3 P2s and 4 P3s. The authority boundaries are sound. The defects are in liveness and persistence around stale or stopped evidence.

## Focused tests (run at this exact pin)
I ran `npm ci`, then `NODE_OPTIONS=--no-experimental-webstorage npx vitest run --maxWorkers=1` with the requested file set.

**Result:** 19 files and 578 tests passed, 0 failed (83.95 s). Per file:

| Test file | Tests |
|---|---|
| App.decisions | 13 |
| monoDecisions | 89 |
| monoDecisionRuntime | 13 |
| commandCenter dir (12 files) | 289, including Decisions 5 and decisionView 4 |
| sessionStore, messageQueue (26), orchestration | remainder of the 578 |

- The prompt delta measured 1071 characters per org chart, and 159 for members.
- I did not run the full suite, browser, tsc or cargo.
- **None of the P1/P2 scenarios below is covered by these tests.** They are code-traced, not executed, because I could not add tests to a read-only checkout.

## Targets

### 1. Authenticated source only reaches decision actions: CLOSED
- **The user actor is built in exactly one place:** `monoDecisionRuntime.ts:85` (`executeDecisionUi`). It is behind `assertDecisionUiGesture` (`:29`), which requires an `Event` with `isTrusted`, `type === "click"` and a target inside `[data-decision-ui]`.
  - A repo-wide search for `kind: "user"` found no other decision constructor. The other matches are CC-GOAL goal handles.
  - The only UI callers are the `Decisions.tsx` card, delegate, autonomy and re-raise buttons, all inside `data-decision-ui`. They pass `nativeEvent`.
- **Mono actions** come only from the authenticated CLI `team.message` ingress (`App.tsx:13945`). The actor is derived from the session, task, roster or `habitRunMono`, never from the payload.
  - `sessionActor` (`monoDecisionRuntime.ts:35`) requires `session.busy`.
  - `validateActor` re-checks actor, generation and binding after hydration, the serialized writer and recovery (`:892-901`, `:929`).
  - The message ID must be `${source}:${requestId}`.
  - `parseDecisionAction` refuses `delegate`/`autonomy`/actor fields.
- **Habit sessions** resolve to their owning Mono, and the tests refuse user impersonation from them.
- **No other path reaches user actions.** Peer `sessions.send` and `goals.message` go through the same Mono-actor path. Restored or queued blocks never reach `executeDecisionUi`.
- `isTrusted` remains an in-app boundary only; OS-level computer use is not excluded, as documented.

### 2. Exact source events carry complete choices and version; retry identity: CLOSED
- **Protocol-2 deliveries** (`monoDecisions.ts:228-243`) carry:
  - `decisionId`, `expectedVersion`, `question`, `impact` and `operation`;
  - the full `options`, `recommendedOptionId` and `optionId`;
  - a 400-character context preview with a truncation flag.
- **Size and legacy handling:** the 4000-character cap is enforced at construction and fails closed. Legacy records keep their exact bytes.
- **Exact rebuild:** `retainedDecisionDelivery` (`:246`) rebuilds only the exact hop for the current version, and receipts are validated against it.
- **Manager visibility:** Managers see the event ID in the digest, plus the full text via `control list`.
- **Idempotency:** retries go through ledger receipts keyed by `requestId` and signature. The UI reuses a stable `requestId` per card/action key.

### 3. Outbox acknowledged only after durable exact read-back: CLOSED for the happy path; see P1-A and P2-A
- **Non-Manager recipients:**
  - The session queue is read back from disk under the serialized writer (`monoDecisionDelivery.ts:18-58`).
  - The App adds a pre-check for consumed evidence: persisted blocks, or the native `mono_session_event_delivered` lookup followed by a full `getMonoGoalRecoveryBlocks` comparison of text and reference (`App.tsx:13688-13700`).
- **Manager recipients:**
  - `control_load` must show the exact event (ID, text, signature) as a member of the current receipt.
  - Then either the queue read-back or the native exact ID+text lookup must succeed (`App.tsx:13664-13681`).
- **Failure handling:** a failed save or read-back throws, and the remaining outbox is kept. Retries dedupe by exact ID and evidence, so I found no double queueing.
- **However:** the "current receipt includes event" requirement and recovery's "first failure throws" behavior create the liveness defects below.

### 4. Stop, generation and binding changes after every awaited setup: CLOSED for guards; OPEN for the empty-pause escape (P1-B)
- **Guards:**
  - `afterDecisionSetup` wraps the setup awaits in `submitSession`. The remaining unwrapped awaits are publication or teardown, or re-enter `submitSession`, which revalidates at entry.
  - `validateDispatch` calls `validateManagerDelivery` immediately before provider publication (`App.tsx:9349`).
  - The consumer captures generation and binding **before** `hydrate()` (`App.tsx:10450-10531`).
  - Digest acceptance re-checks generation, binding and `managerTurnId` around each await (`App.tsx:12828-12860`).
  - `captureIdentity` covers project, task, dispatch, run status and goal.
- **Stop retirement:** `retireDecisionSession` (`monoManagerGoals.ts:272`) runs on Stop.
- **Empty pause:**
  - Explicit chat Send clears the empty pause (`App.tsx:9776`), and so does Resume (`App.tsx:10754`).
  - **Manager Continue does not clear it**, and neither do goal-routed or Mission-bar sends. See P1-B.

### 5. `retiredEventIds` lifecycle: CLOSED, with a P3 race
- **The bypass is narrow.** It applies only when the incoming receipt has the same ID as the latest one and already carries `retiredEventIds` (`managerWake.ts:66-77`).
- **No other transition can re-acknowledge those events** while that receipt is current. Once a new receipt exists, the generic preservation applies again.
- **The orchestrator test** rejects retiring an ordinary report and reopens only the unrelated report.
- See P3-2 for the race.

### Also checked
| Check | Result |
|---|---|
| Answers never start or steer a turn | CLOSED: intake only queues; `canSteerQueuedHead` and `queuedMessageForSubmit("steer")` exclude `monoDecision`. |
| Metadata never creates user blocks or grants | CLOSED: `monoDecision` is kept only on internal blocks; `isManagerUserRequest` excludes internal and `appRequestId` blocks. |
| Autonomy uses the strictest alias, with an audit receipt | CLOSED: `decisionProjectAutonomy` (`monoDecisions.ts:98`); consolidation and audit at `:458-475`. |
| Fresh domain after quarantine | CLOSED, but see P2-B. |
| `bossMayDecide` shared by prompts and runtime | CLOSED: `decisionAuthorityGuidance` (`monoDecisions.ts:154`). |
| Protected operations always go to the user | CLOSED: Boss decides `work` only; delegation is user-only and work-only; operation approvals are unchanged. |
| Recovery effect replays only saved receipts | CLOSED: `App.tsx:13744-13753`. |

## Findings

### P1-A: one stale decision in an unaccepted digest wedges that Manager's whole CC5D pipeline, permanently
- **Where:** `App.tsx:12833` (`acceptManagerDigest` → `assertDecisionDigestConsumer`, `monoDecisionDelivery.ts:84-104`).
- **What happens:** `validate()` runs synchronously at acceptance and throws `StaleDecision` if any `decision:` event in the receipt is stale or not current.
  - The scheduler then retries the **same unacknowledged receipt** forever with backoff (`managerWake.ts:288-318`).
  - `prepareManagerWake` never replaces an unacknowledged receipt, and nothing resets it.
  - The retirement branch (`App.tsx:10580`) exists only in the queue consumer, so it never runs for a digest that was never queued.
- **Scenario 1 (task finishes first):**
  1. While the Manager is busy, a worker asks Q. The event is retained; no receipt exists yet.
  2. The worker keeps working and finishes, so its task is `completed`. `captureIdentity` requires `running`, so Q is now stale.
  3. The Manager goes idle. The receipt {Q, worker report} is prepared, and acceptance throws on every attempt.
  4. Result: the worker's report and all later digests never reach the Manager.
- **Scenario 2 (Stop then Continue):** a pending question event, then Stop (which retires it), then Continue → the next receipt includes it → the same wedge.
- **Why it's P1:** both are ordinary flows.
- **Fix:**
  - Apply the same explicit `retiredEventIds` retirement at acceptance; or
  - exclude retired or stale `decision:` events when preparing the receipt; or
  - mark them acknowledged-retired when the ledger marks them stale.
- **Test:** a worker completes, or Stop+Continue happens, before the digest is accepted. Assert the report is delivered and the next digest forms.

### P1-B: Stop's new empty-queue pause is not cleared by Manager Continue (or by goal-routed sends), so later digests and answers stay parked
- **Where:** `App.tsx:12242` now pauses on every non-refresh Stop, including managed stops for task cancel, retry and interrupt.
- **The escape is incomplete.** It exists only in `onSubmit` (`:9776`) and `onResumeQueue` (`:10754`). These paths bypass it:
  - `continueManager` (`orchestration.ts:1178-1189`): `resumeQueue` returns false on an empty queue, then a managed `submitSession` follows.
  - Boss goal-routed sends (`onSubmitGoal` → `submitMonoGoal` → `submitSession`).
  - The Mission command bar.
- **Scenario:**
  1. The user Stops a Manager. The orchestrator says "Continue or send a message".
  2. The user clicks Continue. The Manager runs and dispatches workers.
  3. Each digest is accepted into the still-paused queue (`canAcceptManagerWake` ignores `queueStatus`; `managerWake.ts:251` keeps `paused`).
  4. That digest never dispatches, and no further digest is accepted while it sits there.
  5. The Manager stays deaf until the user finds and clicks Resume on that queue.
- **The same happens elsewhere:**
  - decision answers queued to workers whose session was managed-stopped and later recovered;
  - Boss escalations after a Boss Stop followed by a goal-routed send.
- **This is a regression:** before this change, an empty queue was not paused.
- **Fix:** clear the empty pause on the user's Continue/Resume of the run and on user goal-routed sends. Or limit the empty pause to user Stops, excluding managed task stops.
- **Test:** Stop → Continue → a worker report digest is consumed without a manual Resume.

### P2-A: `recoverDecisions` aborts on the first failing receipt, which blocks unrelated Mono decision actions and later recoveries
- **Where:** `monoManagerGoals.ts:262-270` throws on the first receipt failure. `handleDecisionTeamMessage` awaits it before every Mono action (`monoDecisionRuntime.ts:133`), and the recovery effect stops at the same receipt.
- **Scenario:**
  1. During the Manager's turn handling Q1, worker W2 asks Q2.
  2. Q2's delivery throws "Manager digest waits", which is expected while the Manager is busy.
  3. The Manager's resolve of Q1 now fails the same way for the rest of that turn. Boss actions on that ledger also fail.
- **Combined with P1-A, this becomes permanent.**
- **Fix:** recover only the target decision's receipt before an action, or isolate per-receipt failures and continue.

### P2-B: quarantine silently relaxes the user's autonomy policy to the least-strict default
- **Where:** `quarantineDecisionHistory` moves `autonomy` together with the decisions (`monoDecisions.ts:348`).
- **Effect:** a single corrupt decision record resets every project's "Ask me for" setting to the default `high-impact-only`. That lets the Boss decide low and medium work that the user had set to `everything`.
- **The test asserts this relaxed default** (`monoDecisions.test.ts`, "preserves corrupt present history…").
- **Fix:** keep the valid autonomy entries. Otherwise, while autonomy evidence is quarantined, treat the domain as `everything`, and show the setting as "unknown – choose again".

### P2-C: Stop retirement is not reliably durable
- **Where:** `retireDecisionSession` (`monoManagerGoals.ts:272-282`).
- **Not-loaded ledgers:** it iterates only loaded ledgers.
- **Failed saves:** a failed save rejects a promise that `onStop` callers discard. There is no retry and no visible error.
- **Effect:** for Manager-level decisions (generation = `goal.createdAt`), Stop → Continue makes the original snapshot current again. Retirement then depends solely on that save, and if it failed, the authority revives.
- **Fix:** surface and retry a retirement failure, or hold the Continue/resume until it is saved.

### P3s
1. **Consumed-check ordering (P3-1):** the digest consumer validates (`App.tsx:10460`, `:10481`) **before** its consumed-transcript check (`:10484`).
   - **Scenario:** a duplicate queued copy of an already-consumed digest, whose decision has since gone stale, takes the retirement path. That reopens and redelivers unrelated reports (a double delivery).
   - **Fix:** check consumed first, as the queued-answer path intends.
2. **Retirement vs. acknowledgement race (P3-2):** `retireDecisionDigest` runs through the orchestrator's `actions` chain. The scheduler's post-accept acknowledgement save calls `commit` directly with a pre-retirement snapshot.
   - If the acknowledgement lands second, reconcile takes the incoming receipt (dropping `retiredEventIds`) and re-acknowledges the reopened events.
   - Result: unrelated reports are lost.
3. **Dropped digest with nothing retired (P3-3):** in the digest retirement branch, `retired` can be empty when the `StaleDecision` came from the `!event` or recipient-mismatch conditions. The digest is then dequeued with a notice while its receipt and events stay acknowledged, so its unrelated items are dropped.
   - **Fix:** throw instead of dequeueing when nothing is retired.
4. **Retry churn (P3-4):** a worker's ingest returns an error ("Manager digest waits") whenever the Manager is busy, even though the question is retained. The prompt's "retry exact requestId" guidance invites retry churn.
   - **Fix:** return a retained or pending result instead of an error.

## Summary of required fixes before integration
- **P1-A:** retire or exclude stale decision events at digest acceptance or preparation.
- **P1-B:** clear the empty Stop pause on Continue and goal-routed sends, or don't pause managed task stops.
- **Strongly recommended in the same pin:**
  - P2-A: per-receipt isolation in recovery;
  - P2-B: keep the autonomy policy through quarantine;
  - P2-C: surface Stop retirement failures.
- Each fix needs a connected App test.
