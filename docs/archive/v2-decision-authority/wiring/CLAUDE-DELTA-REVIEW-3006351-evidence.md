# Claude delta review: candidate `3006351` (repair delta from `136b8fa`)

- **Pin:** HEAD `3006351fd694607dfd4ba66e5ae7701c72a3e307` in the clean detached checkout `v2wire-review`. Delta: `git diff 136b8fa..HEAD`, 31 paths (+1550/-248). Every changed production and test path was read.
- **Scope:** source-only and read-only. I edited no files and ran no node, vitest, tsc, npm, cargo or browser, as instructed. Every scenario below is traced through the code, not executed.

**Verdict: FIX-FIRST.**
- N1, N2, N3, N4, N6, P2-C and all three prior P3s are closed in source.
- N5 is only partly closed. The epoch mechanics meet all 9 Continue conditions and all 5 quarantine conditions.
- **But there are two new P1 defects.**
  - **NF-1:** the epoch makes every later Manager question ambiguous once the Manager has two or more open goals.
  - **NF-2:** a Stop-boundary anchor that can disappear leaves a hold that never clears.

## Prior findings (from the 136b8fa review)

| Item | Status | Evidence / scenario re-traced |
|---|---|---|
| N1 non-persisted hold + recursive submit | **CLOSED** | `decisionOwners` is empty unless `shouldPersistSession` holds and `decisionManagerIds` is non-empty (`App.tsx:12305`). With no owners there is no `prepareDecisionStop`, no marker and no hold. For an Inbox Ask or `~` chat, Stop writes nothing. A held submit is now refused once, with a status line and `onSettled` failed. It sends a background `hydrate(sessionId)` and does not recurse (`App.tsx:7860-7870`). |
| N2 paged retry rewrites history | **CLOSED (source)** | Stop and hydrate retry both use `getMonoGoalRecoveryBlocks` and `save(next,{monoBaseline:history,…})` for paged sessions. Non-paged sessions use `resetMonoSessionWriteBaseline` (`App.tsx:12326-12333`, `13946-13953`). Sessions that hydrate inserts from `readPersistedSession` get a reset baseline (`App.tsx:13914`). So `sessionStore.ts:510-533` no longer diffs a one-block page against a stale full baseline. The paged=true assertion is unchanged. It has not been re-run at this pin. |
| N3 hydrate re-arms hold | **CLOSED** | Hydrate calls `retireDecisionSession(…, hold=false)`, and only when `needsDecisionRetirement` or a real hold exists (`App.tsx:13939-13964`). `isDecisionSessionRetiring(id, createdAt)` ignores decisions newer than `through` (`monoManagerGoals.ts:292`). Re-tracing the worker-B answer race: a historical marker sets no hold, so B's current decision is not retired. |
| N4 global hydrate blocks chat/Continue | **CLOSED** (residual P3-c) | Hydrate is scoped through `decisionManagerIds(scope)`. Failures are kept per owner in a Map, and `decisionUnavailable` is per id (`App.tsx:13889-13976`). `beforeContinue(id)` is scoped. Decisions and WorkspaceGoals disable only affected Managers. |
| N5 no new questions after Continue | **PARTIAL**, see NF-1 | The generation is `max(goal.createdAt, decisionContinuedAt)` (`monoDecisionRuntime.ts:68`). The marker check compares the epoch with `requestStop` (`monoDecisions.ts:191-192`). This works for a single-goal Manager, but a multi-goal Manager breaks (NF-1). |
| N6 acceptance self-deadlock | **CLOSED** | `acceptManagerDigest` returns `undefined` from inside the writer before hydrating (`App.tsx:13056`). It hydrates outside the writer and loops at most twice. Retirement and the recovery commit also run outside the writer. |
| P2-C durable Stop retirement | **CLOSED**, except NF-2 | This combines a full-history marker, exact readback, `allSettled` with ledger retirement, failed outcomes kept held, and a scoped retry. |
| P3-R1 originalSnapshot plain Error | **CLOSED** | It now throws `StaleDecision` (`monoDecisionRuntime.ts:64`). |
| P3-R2 lenient alias survives | **CLOSED** | An invalid alias with a readable sibling becomes `"everything"` (`monoDecisions.ts:380-385`). `decisionProjectAutonomy` lets `"everything"` win (`:98-101`). |
| P3-N1 marker on every chat | **CLOSED** | The marker is written only for related, persisted sessions. |
| P3-N2 onSettled not called | **CLOSED** | Held-submit refusal and the async catch both call `onSettled` (`App.tsx:7867`, `8184`). |
| P3-N3 quarantined event retired silently | **CLOSED** | Quarantined events now take the recovery-notice path. A missing event that is not quarantined still retires silently. Both branches at `monoDecisionDelivery.ts:94-95` are identical, which is dead code (P3-h). |

## Continue-epoch conditions (5 from the verdict + 4 from the revision)

| Condition | Status | Evidence |
|---|---|---|
| Trusted, recent, one-use click bound to the run id | **CLOSED** | The event must be `isTrusted`, ≤5000 ms old by `timeStamp`, and not already in the WeakSet. Its target must be `closest([data-manager-continue])` with `data-run-id===runId` (`managerAuthorizedWork.ts:16-29`). All three Continue buttons carry `data-run-id={leadId}` and pass the native event. A replayed or synthetic event throws. |
| WeakSet | **CLOSED** | `usedContinuationEvents` (`:12`). The grant is a WeakMap entry that cannot be forged; `{id:"forged"}` throws (orchestration test). |
| Pending is inert on reload and skipped by every recovering consumer | **CLOSED** | Normalize forces `paused`/`recovering:undefined` (`orchestrationState.ts:232-234`). Every recovering consumer refuses pending: `hydrateRun` recovery (`orchestration.ts:1023-1024`), `start` (`:1187`), `beginManagerTurn`, `reconcileManagerWake` and the scheduler (`managerWake.ts:146,276,298`), candidate runs (`monoDecisionRuntime.ts:119`) and `captureIdentity`. |
| `captureIdentity` refuses paused runs, plus an in-flight guard | **CLOSED** | `captureIdentity` requires `status==="active"` and no pending. `decisionActivating` is held from entry until immediately before `start` (`orchestration.ts:1305-1350`). `start`, `beginManagerTurn` and `assertDecisionContinuation` all check it. Recovery excludes paused runs that carry an epoch. |
| Stop clears or supersedes pending | **CLOSED** | Stop calls `retireDecisionContinuation` → `decisionStops` synchronously, then commits pending=undefined (`orchestration.ts:1266-1274`). Hydrate also retires pending ≤ `through` (`App.tsx:13937-13938`). A failure after Stop leaves pending undefined in memory (`:1365`). |
| Send mints only from a trusted composer gesture, never from block role; peer `sessions.send` and restored bubbles mint nothing | **CLOSED** | A paused Manager Send requires `options.continuationGesture`, which only `captureManagerContinuationGesture(composerEvent)` sets. Managed, appRequestId, completion, habit and automation sends, and the owner-mismatch case, are refused (`App.tsx:8079-8081`). The block must also be `isManagerUserRequest`, saved and read back. Only SessionPane and MissionCommandBar set `composerEvent`. |
| Idempotency scope | **CLOSED** | The key is `requests["decision-continue-"+gesture.id]` with a signature that includes `stoppedAt`. A prior result ≤ `stoppedAt` or a different signature throws. A new gesture gets a new epoch > max(Stop, active, pending) (`orchestration.ts:1317-1322`). |
| Latest-Stop recheck at activation | **CLOSED** | `validate()` compares `cutoff()` with `stoppedAt` after every await. The same check runs after the pre-activation load, the activation commit and the readback. After `start`, `assertDecisionContinuation` checks `decisionStops<epoch`. |
| Owner-engine Stop | **CLOSED** (P3-e) | `stopForSession` now matches `ownerSessionId` and pauses `run.leadId` (`orchestration.ts:3258-3262`). Before this, the owner-session Stop dereferenced an undefined task. |
| Post-await and native readback bindings | **CLOSED** | Reads are done three times: stage, prepared and active. `verifyDecisionAuthority` reads the saved binding, the paged blocks and the `control_load` ledger. A post-start generation is captured fresh, and pre-start checks keep the original generation. |

## Quarantine conditions (5)

| Condition | Status | Evidence |
|---|---|---|
| Notice and retirement in one commit, with readback | **CLOSED** | One `commit` appends the notice and sets `retiredEventIds`; `store.load` then verifies both (`orchestration.ts:518-536`). Any failure commits paused. The scheduler sees the run as paused while `decisionRecoveringDigests` is set (`:405`). The test asserts `notice===retired` for every write. |
| Source bound at the commit | **CLOSED** | `validateRecovery` runs synchronously before the commit and checks the receipt id, sorted eventIds, owner and quarantine raw. The App validate covers turnGen, binding, queue head and receipt body. |
| Deterministic id that matches neither decision nor report patterns | **CLOSED** | The id is `recovery:<receipt>:<sha256(sorted ids)>`. It does not match `isMonoDecisionEventId` (`/^decision:…/`). Same id and body is verify-only; a conflict pauses and throws. Only one notice is allowed per receipt prefix. |
| Content from the host template only | **CLOSED** | The text is a fixed template plus a count, the decision event ids and a pointer to Decisions. Kind is `info`, with no `monoDecision` metadata. |
| Re-raise guarded | **CLOSED** | No change to `reraiseUnreadableDecision`. A re-raise is gated per Manager when that Manager is unavailable. |

## Previously closed authority items

None regressed.
- **User actor:** only `executeDecisionUi` behind `assertDecisionUiGesture` builds one.
- **Mono actor:** still built from the authenticated `team.message`. The scoped hydrate is followed by `validateActor`.
- **Steering:** answers still do not steer.
- **Protected operations:** still go to the user.
- **Grants:** the gesture grant carries no actor and no permission.

**Stop is still immediate for ordinary sessions.** For Manager or owner sessions, the cancel still runs after the pause commit; that pattern was already there before this delta (P3-e).

## New findings

### NF-1 (P1): after any trusted Continue or paused-Manager Send, a Manager with ≥2 open goals can never raise a decision again

- **The cause:** `monoDecisionRuntime.ts:126` adds `run.decisionContinuedAt !== undefined ||` to the candidate predicate for Manager actors. Every open goal of that run in the project becomes a candidate. `:131` then throws `"Decision needs one unambiguous original goal context"` unless exactly one candidate remains.
- **Scenario:**
  1. A Manager has goals A and B (the Manager prompt says "several goals may proceed at once").
  2. The run pauses for any reason, and the user clicks Continue.
  3. The Manager then asks about A. The ask can be bound to A's own user turn, so before this change it had exactly one candidate.
  4. Now it has two candidates (A by turn, B by the epoch clause) and is refused.
- **Why it is permanent:**
  - The epoch is never cleared.
  - `startRun` copies `previous.decisionContinuedAt` into restarted runs (`orchestration.ts:1617`).
  - So every later question in that engine fails, including ones in fresh user turns.
- **Impact:** protected-operation escalations can no longer reach the user. The tests only use single-goal fixtures.
- **Fix:**
  - Apply the epoch clause only when nothing turn-bound matched.
  - Or limit it to goals created before the epoch, and require uniqueness across that set.
  - Or take the goal from the payload and validate it.

### NF-2 (P1): a Stop whose last block is a pending approval leaves a hold that never clears and wedges the Manager chat until restart

- **The cause:**
  - `stopAfterBlockId` is the last block captured *before* `stopStreaming` (`App.tsx:12304`).
  - `stopStreaming` → `settlePendingApprovals` drops undecided `role:"approval"` blocks (`apply.ts:576`).
  - `appendDecisionStopMarker` then throws `"The original Stop boundary is unavailable"` (`monoDecisions.ts:247`).
- **Sequence:**
  1. The writer rejects.
  2. `retireDecisionSession(...,false)` deletes the hold.
  3. `stopFailure` re-holds with the same anchor (`App.tsx:12307-12308`).
  4. Every retry reuses `decisionRetirementAnchor` (`App.tsx:13950`) and throws again. Line `13964` is never reached.
- **Effects:**
  - **Submit is refused** with "Stopped decision work is still being saved" (`:7860`).
  - **Continue fails:** `beforeContinue` → scoped hydrate throws.
  - **The Stop notice is wrong:** it says "Continue will retry", which never succeeds.
- **Reachability:** any Stop pressed while a Manager waits on an approval prompt. Edited or resent turns that replace the last block hit the same root cause.
- **Fix:**
  - Capture the anchor after `stopStreaming`.
  - Or fall back to the nearest surviving earlier block, or to "append at end", instead of throwing.
  - Never hold on an anchor that cannot be resolved.

### NF-3 (P2): the 5000 ms gesture bound covers the whole verification pipeline, not just the click

- **The cause:** `validateGesture` (`managerAuthorizedWork.ts:36`) runs inside every `validate()` of `resumeDecisionManager`, up to activation. That includes waiting on the `actions` chain, the scoped hydrate, three `verifyDecisionAuthority` passes (paged history and `control_load` per owner), `probeProviders` (`orchestration.ts:1333`), three loads and two commits.
- **The Send path adds more first:** hydrate, then save and readback of the user block, plus any codex-storage preparation.
- **Effect:**
  - On a slow or memory-starved machine, every Continue fails with "expired", and a retry repeats the same work.
  - **Duplicate user blocks:** in the Send path the user block is already saved, but it is never published to the provider. A retry appends a second block.
- **Fix:**
  - Check recency only at capture and first take.
  - After that, bind to the request id and the Stop cutoff.

### NF-4 (P2): every trusted Continue invalidates outstanding Manager/Boss-raised decisions, even after non-Stop pauses

- **The cause:** the identity includes `generation`, and `assertDecisionCurrent` compares the identity by equality (`monoDecisions.ts:222`). A new epoch changes the generation of every older goal.
- **Scenario:**
  1. The run pauses on a follow-up limit, a usage limit, an interrupted turn, a save failure, or an app restart. Crash recovery no longer auto-starts a run that has an epoch, see P3-a.
  2. The user clicks Continue or sends a message.
  3. Every pending Manager question that awaited the user becomes stale with no Stop involved.
- **Needs a product decision.** This conforms to the contract, but it extends "old evidence stays retired" to pauses that never retired anything.
- **Suggested change:** mint an epoch only when a Stop cutoff exceeds the previous epoch.

### NF-5 (P2): `verifyDecisionAuthority` binds every historical goal of the Manager, including done and cancelled ones

- **The cause:** `App.tsx:13001-13014` requires, for every goal with `managerId===id`, all of the following:
  - a live owner Mono and session;
  - an exact persisted user block;
  - JSON equality of the goal with the retained ledger.
  
  `decisionAuthority` likewise returns undefined unless every goal owner's history is `"ready"` (`:12986-12987`).
- **Effect:** one old finished goal whose owner session was deleted, or whose user block was edited, resent or is otherwise absent, blocks Continue and paused Send for that Manager permanently.
- **Fix:** scope to open goals, and to goals bound to the continuation.

### P3s

- **a. Crash recovery is now off for any run that ever had an epoch.** Hydrate first commits active→paused, and then `start` refuses at `orchestration.ts:1187`. This changes the "non-pending crash recovery unchanged" claim.
- **b. Paused-Manager Send refuses all non-gesture submits** (`App.tsx:8081`), including Retry delivery of queued user messages after Stop. This contradicts "programmatic paths retain old behavior". It is recoverable through Continue.
- **c. `prepareDecisionStop` loads every related owner ledger with no isolation** (`monoManagerGoals.ts:305`). One unreadable related ledger makes every Stop of that session (including the Boss) fail and hold. Hydrate can then clear the hold only through another owner's pass.
- **d. A worker Stop advances the Manager's `decisionStops`** (`orchestration.ts:1267-1269`). That can abort an unrelated Manager Send or start (`assertDecisionContinuation` / startRun throws "Stopped while the Manager was starting").
- **e. Owner/lead Manager Stop cancels the harness only after the pause commit's save resolves.** It never cancels if the save rejects (`.then` at `:3262`). This was already true before for lead sessions; it now also applies to owner sessions.
- **f. Writer loops never give up.** The `for(;;)` loops in Stop, hydrate and the paused Send writer retry on every `sessionsRef` change and have no bound. The paused Send writer then throws "submitted user request is unavailable" after its block was already saved to disk.
- **g. `decision-continue-*` entries accumulate.** They are never pruned from `run.requests`, so they count toward the 512-command limit.
- **h. The quarantine path's edge cases are not verified.**
  - The quarantined and non-quarantined branches in `staleDecisionDigestEvents` are identical.
  - `retireDecisionDigest` commits the receipt object captured before the crypto await.
  - A retry whose retired set or quarantine hash changed is a permanent conflict-pause.
- **i. Only the unrun browser suite covers the core Continue path.** The "stopped" fixture's positive programmatic Continue became a refusal, followed by a manual `replace({status:"active"})` (`App.decisions.test.ts:409-414`).

## Test-weakening check

- **Managed Stop cases:** they add `vi.waitFor(…, {timeout:1000})` before the original assertions, which are kept. The test IDs are unchanged.
- **Paged test:** the paged=true assertions are unchanged.
- **Mission and routed tests:** these only extend the expected call arguments.
- **No assertions were removed** other than the documented programmatic-Continue positive (P3-i).
- **Independent 1000 ms real-writer regression:** its paths are not in the delta.
- **Validation status:** focused, browser, tsc and build have not run at this pin, per REVIEW-DELTA.

## Required before integration

1. **NF-1:** a fix, plus a multi-goal test covering post-Continue and later user turns.
2. **NF-2:** a fix, plus a test for Stop while an approval is pending.
3. **NF-3 and NF-5:** strongly recommended in the same pin.
4. **NF-4:** a product decision.
5. **Then:** a focused, browser, tsc and full run at the exact pin.
