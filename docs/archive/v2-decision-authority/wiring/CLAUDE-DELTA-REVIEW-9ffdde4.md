# Claude source verdict: 9ffdde483c96c73bfddc3e03b0419ee59d1c0d58 (tree 557fb72…), covering 3006351 and its delta

**Verdict: FIX-FIRST (source).** Evidence for 3006351: `CLAUDE-DELTA-REVIEW-3006351-evidence.md`.

## 9ffdde4 seam: ACCEPTED
- The scoped `beforeContinue` preparation now runs **before** the actions chain is claimed, which removes the L/A cycle where actions held A while waiting on ledger L.
- The concurrency guard runs synchronously at entry: `decisionActivating`/`starting`/`decisionStarting`, and `decisionActivating.add` happens before the first await. There is no window for a double Continue.
- `validate()` runs before and after preparation and again when the chain is reacquired. Staging, activation, read-back and the post-start checks are unchanged.
- The failure handler is now bound to the same owner and session, and to paused status or the same epoch, so it can't stomp a replaced run.
- The gesture is consumed at entry even when the call is refused as already preparing, so the user has to click again. That is acceptable.

## Closed at 3006351 (source)
- N1, N2, N3, N4, N6, P2-C and the earlier P3s. **N2 still needs the paged test re-run at this exact pin.**
- All 9 Continue conditions, all 5 quarantine conditions, and owner-engine Stop.
- No regression to any CLOSED authority item.
- No test assertion was weakened; the 1000 ms waits and the paged assertions are intact.

## Required (open)
- **NF-1 (P1): one Continue kills decisions for multi-goal Managers.** `monoDecisionRuntime.ts:126` makes every open goal a candidate, so `:131` always reports "ambiguous".
  - Effect: after any Continue or Send epoch, a Manager with two or more open goals can never raise a decision again, including protected ones that should reach the user. The epoch also persists into restarts.
  - Fix: candidates must use the request's exact goal binding. The epoch only raises the generation floor; it must not widen the candidate set.
  - Test: two open goals, then Continue, then a question on goal B resolves to B.
- **NF-2 (P1): Stop during a pending approval wedges the chat.** The Stop marker is anchored to the approval block, which Stop removes, so the marker save fails on every retry and Sends and Continue are refused until restart.
  - Fix: anchor the marker to a block that survives Stop (the last persisted non-approval block, or the session end), or write the marker after approval removal against a fresh baseline.
  - Test: approval pending, then Stop, then a Send works.

## Strongly recommended in the same pin
- **NF-3:** the 5-second gesture limit must apply at **gesture intake only** (take or consume), not across the probe and verification chain.
  - A failed Send must not leave an undelivered user message whose retry duplicates it. Either reuse the same request id on retry, or roll back the user block.
- **NF-4 (default decided):** Continue mints an epoch **only when a Stop cutoff is newer than the current active epoch.** Continue after a usage-limit, follow-up-limit or error pause (no Stop) mints nothing, so the questions waiting on the user stay valid. This follows the user's rule that only Stop retires authority. Test both.
- **NF-5:** the Continue authority check should cover only the goals and requests that are **open** and bound to the run. A finished goal with a missing historical message must not block Continue.
- **P3s:** see the evidence. In particular, crash recovery of a run that was continued once must still auto-resume the non-pending crash case, as the approved revision required "non-pending crash behavior preserved".

## Gates
All unrun at this pin:
- affected tests and the paged test;
- the 22 browser frames, which hold the only positive trusted-Continue test;
- tsc, build and the full suite.

This is a source-only verdict; it does not clear runtime or release.
