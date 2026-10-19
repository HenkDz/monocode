# Claude final V2 wired verdict: 438741c (and c993d69)

**Verdict: FIX-FIRST. Not approved for integration.**

**Pins reviewed**
- c993d6912c5902e7f2692153371d06f7417a80cf, tree ac6f35a7…: full source review.
- 438741ca7874407ca72dc9811002d9814bb2bf27, tree 2927abe9…: the delta, 8 paths, +55/−16.

**What the 438741c delta does.** It adds `isMonoDecisionEventId` (the full V2 regex) and a digest identity preflight. This correctly stops legacy `decision:report:*` events from being treated as V2 decisions. Accepted.

**It does not address the findings below, which carry forward unchanged.** Evidence: `CLAUDE-WIRED-REVIEW-evidence.md`, with file:line references and scenarios.

**CLOSED (authority)**
- Only trusted UI gestures act as the user.
- Mono actor comes only from the authenticated `team.message`.
- Protocol-2 events carry the complete choices and version.
- Retries are idempotent.
- Outbox is acknowledged only after exact read-back (happy path).
- Setup/publication guards hold.
- Narrow retiredEventIds bypass.
- No steering from answers.
- Strictest autonomy alias.
- `bossMayDecide` is shared.
- Protected operations go to the user.

Focused tests at c993: 578/0 across 19 files. None of them covers the P1/P2 items.

## Required before integration
- **P1-A: digest wedge.** Acceptance (`App.tsx` ~12834, `assertDecisionDigestConsumer`) throws `StaleDecision` synchronously. The scheduler then retries the same unacknowledged receipt forever, and the only retirement path is in the queue consumer.
  - Scenarios: a worker asks, then completes before the Manager is idle; or Stop → Continue with a pending question. Either way, that report and all later digests never reach the Manager.
  - Fix: retire or exclude stale V2 decision events at preparation or acceptance, using the same retiredEventIds receipt, so unrelated events still deliver.
  - Connected App test: a worker completes, or Stop+Continue happens, before acceptance. Assert the report is delivered and the next digest forms.
- **P1-B: the empty Stop pause is cleared only by chat Send or Resume.**
  - Not cleared by: `continueManager`, goal-routed `submitMonoGoal`, the Mission bar.
  - Managed task stops (cancel/retry/interrupt) also pause.
  - Effect: later digests and answers park in a paused queue. This is a regression.
  - Fix: clear it on Continue and goal-routed user sends, and/or pause only on user Stops.
  - Test: Stop → Continue → a worker digest is consumed without a manual Resume.

## Strongly recommended in the same pin
- **P2-A:** `recoverDecisions` aborts on the first failing receipt. A Manager-bound outbox waiting on a busy Manager then blocks every Mono decision action on that ledger. Isolate failures per receipt, or recover only the target decision.
- **P2-B:** quarantine moves `autonomy`, which resets the user's "Ask me for" to the least-strict default. Keep the valid autonomy entries, or treat the setting as `everything`/unknown until the user chooses again.
- **P2-C:** Stop retirement iterates only loaded ledgers, and its save failure is discarded. Surface and retry it, or hold Continue until the save lands.

## P3 (may follow)
1. In the queued digest consumer, run the consumed-transcript check before validate.
2. Retirement vs. the scheduler acknowledgement commit can race (lost retiredEventIds). Serialize them through the same actions chain.
3. If the retirement branch has nothing retired, throw instead of dequeueing.
4. A worker ingest during a busy Manager should return "retained/pending", not an error (retry churn).

Re-review: the delta only, plus the connected tests for P1-A/B (and P2s if included). The prior CLOSED items stand unless the delta touches them.
