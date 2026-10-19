# Claude delta review: candidate `136b8fa` (repair delta from `438741c`)

- **Pin:** HEAD `136b8fa80e9c05724dc0e15e258d640f83744760`, tree `005fcfc4080cace74d77c943e5b06fd026878121`, in the clean detached checkout `v2wire-review`.
- **Delta:** `git diff 438741c..HEAD`, 14 paths (+453/−99). I read every changed source and test path.
- **Scope:** read-only. I edited no files, and ran no build, tsc, browser, cargo or full suite.

**Verdict: FIX-FIRST.**
- The exact-pin focused run is red.
- Two new P1 liveness and data-integrity defects were introduced by the Stop-marker/hold mechanism.
- Every prior P1/P2/P3 is otherwise closed in its described scenario.
- The authority boundaries have not regressed.

## Focused tests (exact pin)
Command: `NODE_OPTIONS=--no-experimental-webstorage npx vitest run --maxWorkers=1 src/app/App.decisions.test.ts src/features/monos/model/monoDecisions.test.ts src/features/orchestration/model/orchestration.test.ts`

**Result: 3 files, 240 tests. 239 passed, 1 FAILED** (deterministic; it reproduces with `-t "paged=true"`).

- **Failing test:** `App.decisions.test.ts > loads dormant ledgers on managed Stop, surfaces failed retirement and remains stale after reload (paged=true)`.
- **Error:** `Stop evidence could not be verified`, thrown by `App.tsx:13730`.
- **Cause, traced:**
  1. The first `hydrate()` calls `restored.retireDecisionSession`. That call sets the retiring hold at entry (`monoManagerGoals.ts:286`), then fails as the test intends, so the hold persists.
  2. The second `hydrate()` therefore takes the `writeSession(save(current))` branch (`App.tsx:13725`).
  3. `current` is the paged session returned by `readPersistedSession` (one block). `readPersistedSession` does not reset `monoSavedBlocks` (`sessionStore.ts:723-730`; only `getSession`/`loadSession`, `:742`, does).
  4. `saveSessionSnapshot` diffs against the stale full baseline. It finds `same=0` and sends `fromBlockId = previous[0].id` (`sessionStore.ts:529-533`).
  5. The anchor-faithful native mock then **replaces the whole persisted history with the one loaded block**. The Stop marker is erased with it, and readback fails.
- **Consequences:**
  - CHECKPOINT/REVIEW-DELTA's "expected 522" is not met.
  - The failure shows the retry path writing a partially loaded session against a stale baseline. In production that path can delete persisted transcript history whenever a session was saved earlier in the same app lifetime and later re-inserted into `sessionsRef` from `readPersistedSession`, as hydrate does at `App.tsx:13709-13713`.
  - The verification failure also means the hold never clears, so that session's submit is refused until restart. See also N1.

## Prior items

| Item | Status | Evidence / scenario |
|---|---|---|
| **P1-A** stale V2 event wedges CC5D | **CLOSED** (residual P3-R1) | See P1-A below. |
| **P1-B** empty Stop pause | **CLOSED** (side effect N4) | See P1-B below. |
| **P2-A** recovery isolation | **CLOSED** | See P2-A below. |
| **P2-B** quarantine relaxes autonomy | **CLOSED** (edge P3-R2) | See P2-B below. |
| **P2-C** durable Stop retirement | **OPEN** | See P2-C below. |
| **P3-1** consumed-first | **CLOSED** | See P3 items below. |
| **P3-2** retire vs ack serialized | **CLOSED** | See P3 items below. |
| **P3-3** throw on empty retirement | **CLOSED** | See P3 items below. |
| **P3-4** pending ingress | **CLOSED** | See P3 items below. |

### P1-A: CLOSED (residual P3-R1)
- **Acceptance now classifies stale events itself.**
  - `acceptManagerDigest` calls `hydrate()` and then `staleDecisionDigestEvents` (`App.tsx:12881-12896`).
  - Stale members are retired through `retireDecisionEvidence` and `orchestrator.retireDecisionDigest`, and acceptance returns false.
- **Unrelated reports reopen.** They get `acknowledgedAt` undefined and `delivered:false` (`orchestration.ts:467`).
- **The scheduler moves on.**
  - It returns on a retired or replaced receipt instead of throwing (`managerWake.ts:302`).
  - The `finally` → `sync` step prepares the next receipt.
- **Classification:** shared function `monoDecisionDelivery.ts:85-101`.
- **Task-completed case:** the generation fallback `dispatch?.startedAt ?? decision.identity.generation` (`monoDecisionRuntime.ts:59`) turns "task completed or dispatch gone" into a `StaleDecision` inside `captureIdentity`, not a plain Error.
- **Tests:** completed and Stop→Continue scenarios both pass, including report delivery and the next wave.

### P1-B: CLOSED (side effect N4)
- **The empty pause is gone.** Stop pauses only when `queuedHead(ready)` exists (`App.tsx:12269`).
- **Continue, goal and Mission paths** are exercised by tests and are no longer parked.
- **Stop remains immediate:**
  - `stopStreaming`, the turn-generation bump and harness cancel stay synchronous.
  - Retirement runs in parallel and does not gate cancel (`App.tsx:12226-12274`).
  - `host.stop` does not await `onStop` (`App.tsx:13012-13014`).

### P2-A: CLOSED
- **Per-receipt isolation:** recovery collects failures per receipt (`monoManagerGoals.ts:268-281`).
- **Targeted action recovery:** action ingress recovers only `command.decisionId` (`monoDecisionRuntime.ts:134`), and throws only on that target's failure.
- **Test:** "unrelated pending questions" passes.
- **Minor note:** failures returned to the mount effect are not surfaced. They are retried on the next effect or action.

### P2-B: CLOSED (edge P3-R2)
- **Readable entries are kept.** Valid autonomy entries are retained through quarantine (`monoDecisions.ts:368-375`).
- **Unknown policy is strict.** When quarantine is present and the project has no entry, the policy is "everything" (`:101`).
- **Consistent everywhere.** The value is used in the resolve check (`:518`) and in the UI (`monoManagerGoals.ts:230-236`, `WorkspaceContext.tsx:349`), and the UI labels the uncertainty.

### P2-C: OPEN
**What now works:**
- All Manager ledgers are loaded before retirement (`monoManagerGoals.ts:288`).
- A failure is surfaced as an error notice and held (`App.tsx:12212-12218`).
- Submit (`:7846`) and Continue (`:12857`, `orchestration.ts:1196`) retry hydration.

**Remaining problems:**
- The paginated readback regression fails at this pin (above).
- The hold mechanism introduces N1, N2 and N3.

**Marker forgery check: CLOSED.**
- `isDecisionStopMarker` (`monoDecisions.ts:238`) requires role `system`, id `decision-stop-<digits>` and the exact text.
- System block ids are app-generated: `crypto.randomUUID` or `eventId()` (`apply.ts:32`), or fixed app prefixes (`omp-interjection-`, `ci-stop-`, `retired-`). A Mono's `team.message` or user text becomes a role-`user` block and cannot set an id.
- A forged marker could only *restrict*:
  - `captureIdentity` rejects (`monoDecisions.ts:190-191`).
  - `retireDecisionSession` marks decisions stale.
  - Nothing reads a marker to restore or grant authority.
- The marker is not a user request: `isManagerUserRequest` requires `role==="user"` (`managerAuthorizedWork.ts:50`).

### P3 items: all CLOSED
- **P3-1 (consumed-first):** checks run before validation in the consumer (`App.tsx:10454-10484`) and at acceptance (`:12866-12880`). The test shows no retirement and no reopen.
- **P3-2 (retire vs ack):** `saveManagerWake` uses the actions chain and refuses to overwrite an explicitly retired receipt (`orchestration.ts:449-458`). Both orders are tested.
- **P3-3 (empty retirement):** an empty retirement now throws: `if (head.managerWake && !retired.length)`.
- **P3-4 (pending ingress):** returns `DecisionDeliveryPending`, which yields `{delivery:"pending"}` only after the source event is durably verified via `control_load` (`App.tsx:13757-13761`, `monoDecisionRuntime.ts:123-133`). Corruption still errors.

### Previously CLOSED authority items: no regression
- The trusted UI gesture is still the only user actor. `executeDecisionUi` and `assertDecisionUiGesture` are unchanged.
- The Mono actor still comes from the authenticated `team.message`. The new pending catch re-runs `validateActor` and returns only the ledger's own status.
- Answers still do not steer.
- Protected operations still go to the user.
- No metadata actor and no new grant were added. The marker and the hold only add fail-closed conditions.

## New findings

### N1 (P1): Stop in a non-persisted chat leaves a hold nobody clears, so the next send loops forever
- **Which chats:** Inbox Ask (`inboxAsk`), `cwd:"~"` chats, and ephemeral habit runs. `shouldPersistSession` returns false for all of them (`sessionStore.ts:148-156`).
- **Step 1:** the Stop marker `save()` returns null, so the write throws "Stop evidence could not be saved" (`App.tsx:12231`). `stopFailure` then sets the hold (`:12213`).
- **Step 2, the race:** `retireDecisionSession` runs in parallel. Its delete only applies if it finishes *after* `stopFailure`.
  - With cached ledgers and an idle serial tail, it finishes in about N+1 microtasks (N = number of Managers).
  - The rejection that triggers `stopFailure` needs about 8–9 microtasks.
  - So for typical rosters the hold is set **after** the delete, and persists.
- **Step 3:** these sessions are not in hydrate's `ids` set (`App.tsx:13702-13706`), and they have no saved marker. Hydrate can never clear their hold.
- **Step 4:** the next user send hits `submitSession`, which calls `hydrate().then(submitSession)` (`:7846-7847`). The hold is still set, so this recurses without end.
  - If no hydrate step does IPC, this is a pure microtask spin and the renderer freezes.
  - Otherwise it is an endless IPC loop.
  - Either way the message is never sent, and no `onSettled` fires.
- **Even when the race goes the other way,** every Stop in these chats shows "Stopped, but decision retirement still needs saving…".
- **Fix:**
  - Do not write a marker or hold for sessions that are not persisted, or that no decision identity references.
  - Make `submitSession` fail once with a visible error instead of recursing.

### N2 (P1): the exact-pin focused test is red, and the paginated retry save can erase persisted history
This is described under Focused tests above.
- **Fix:** the retry path must not `save(current)` a `readPersistedSession`-sourced paged session against a stale baseline. Either:
  - reset the baseline via `resetMonoSessionWriteBaseline` / `getSession` for sessions inserted by hydrate; or
  - verify the marker without rewriting the transcript, and append only when the marker is missing.

### N3 (P2): every hydrate makes sessions with any old Stop marker "retiring" for a while, so valid answers can be dropped as stale
- **The trigger is broad.** For every session with any historical marker, hydrate calls `retireDecisionSession` (`App.tsx:13731`). That sets the hold synchronously (`monoManagerGoals.ts:286`) and clears it only after the serial ledger work finishes.
  - Hydrate runs on every Mono decision ingest or action (`monoDecisionRuntime.ts:85,106,150`), on consumers, on acceptance and on `monosSnap`.
  - Manager sessions accumulate markers on every Stop, permanently.
- **Why it matters:** `originalSnapshot` treats a retiring session as `cancelling` (`monoDecisionRuntime.ts:61-62`). During that window, `assertDecisionCurrent` throws `StaleDecision` for **current** decisions on new goals.
- **Scenario:**
  1. Worker A ingests a question. Its ledger save holds the serial tail (IPC).
  2. Meanwhile the consumer delivering worker B's answer re-validates after an await, and gets `StaleDecision`.
  3. The retirement branch (`App.tsx:10594-10627`) runs. Either `retireCurrent` retires B's decision (still inside the window), or it no-ops (window passed).
  4. In both cases the answer is **dequeued** with "Retired outdated decision evidence".
  5. The ledger receipt is already cleared, so the answer is lost.
  6. The same race at acceptance retires valid digest questions.
- **Fix:** do not re-arm the hold from hydrate's idempotent re-retirement. Use the hold only for the failed-Stop case, keyed by `through`. Or ignore it once the marker is verified.

### N4 (P2): any decision-hydration failure now blocks chat and Continue
- **Where:** `beforeContinue` always runs the full `hydrate()` (`App.tsx:12857`, `orchestration.ts:1196`). Held sessions' submits go through `hydrate()` as well.
- **Failure source:** hydrate throws on any unrelated failure:
  - "Unsupported Mono goal history" in any Manager ledger (`monoManagerGoals.ts:193-205`);
  - an unreadable paged history;
  - a failed `readPersistedSession`.
  `retireDecisionSession` also loads every Manager ledger, so the same corruption makes every Stop fail retirement.
- **Scenario:** one corrupt Manager ledger means:
  - every Manager's Continue rejects;
  - every stopped session refuses sends until app restart, including plain chats, because the Stop write hold applies to all sessions.
- Before this delta, chat and Continue were independent of decision hydration.
- **Fix:** scope the preflight to the stopped session's own retirement, and do not fail Continue on unrelated ledgers.

### N5 (P2): after any Stop, the same goal can never raise a decision again, even after an explicit Continue
- **Rule:** `captureIdentity` rejects any goal whose request block precedes a marker in the request session, and any requester whose marker is at or after `goal.createdAt` (`monoDecisions.ts:190-191`).
- **Effect after Stop → Continue (or the save-failure stop at `orchestration.ts:793`):**
  1. The Manager and its newly dispatched workers keep working the same goal.
  2. Every new `team.message` decision fails with "Decision has no current original request/dispatch authority".
  3. Protected-operation questions cannot reach the user.
- **Gap in tests:** the "stopped" test checks only report delivery, not a new question after Continue.
- Retiring *old* evidence is right. Refusing *new* questions after a trusted Continue is a liveness gap.
- **Fix:** record a Continue epoch, or compare against dispatch generation for new questions, instead of request position.

### N6 (P2): acceptance can deadlock itself while a failed hold persists on an active Manager
- **Where:** `acceptManagerDigest` runs `hydrate()` inside `writeSession(managerSession)` (`App.tsx:12858-12882`). If the Manager session is held and has a marker, hydrate calls `writeSession(managerSession)` (`:13725`). That call queues behind itself and never runs.
- **Reachable when:** a managed Stop leaves the run active (ResourcePressure `onStopAgent` → `onStop(id, true)`, `App.tsx:18472`) and the retirement save failed.
- **Effect:**
  - all later saves for that session hang;
  - the scheduler stays `delivering`.
- **Fix:** call hydrate before entering `writeSession`, as the consumer does at `:10490`.

### P3s
1. **P3-R1:** `originalSnapshot` plain Errors (`monoDecisionRuntime.ts:53`) still escape `staleDecisionDigestEvents`. Examples are a deleted requester session, run or goal. The digest is then retried forever, so that residual wedge remains.
2. **P3-R2:** quarantine keeps a valid lenient alias, for example `high-impact-only`, even when a stricter alias was dropped as corrupt. The policy can then be looser than "unknown → everything".
3. **P3-N1:** every non-refresh Stop on **every** chat, including non-Mono chats, appends the visible system line "Stopped. Earlier decision evidence cannot resume this work."
4. **P3-N2:** a hydrate rejection in `submitSession` (`App.tsx:7847`) never calls `options.onSettled`. Callers waiting on it, such as orchestrator dispatch, may hang.
5. **P3-N3:** `staleDecisionDigestEvents` retires an event whose ledger decision is missing (`monoDecisionDelivery.ts:93`). After a quarantine, the question is acknowledged without the Manager seeing it. It is recoverable only by re-raise.

## Required before integration
- **N1:** no hold or marker for non-persisted, untracked sessions, and a non-recursive submit guard.
- **N2:** a green paged test, with no transcript rewrite against a stale baseline.
- **Same pin, strongly recommended:**
  - N3: no transient hold from hydrate;
  - N4: scope the preflight;
  - N6: hydrate outside `writeSession`.
- **Product decision on N5:** should new questions be allowed after Continue?
