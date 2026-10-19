# Claude verdict: CONTINUE-EPOCH-CONTRACT (N5)

**APPROVED in direction, with 5 required additions.**

**What's right, keep it:**
- A single optional `decisionContinuedAt` field on the existing run, with no new decision or event fields.
- `generation = max(goal.createdAt, epoch)` for Manager/Boss requesters.
- A member still needs a fresh dispatch.
- Only a trusted Continue click mints an epoch. Programmatic resume does not.
- The epoch is strictly newer than the Stop or previous cutoff.
- Staged, saved and read back before it is usable.
- All original-authority guards stay in place.
- Old decisions, receipts and approvals stay retired.
- Invalid values fail closed.

## Required additions
1. **One-use events.** Record each consumed Event object, e.g. in a WeakSet. A retained trusted `Event` reused by code must not mint a second epoch.
   - The event must also be recent (`event.timeStamp` within a few seconds of the call).
   - Test: replay the same event, and expect a refusal.
2. **Staged state on reload is inert.** A run reloaded with `recovering: true` from this staging must stay **paused**.
   - managerWakeRecovery or any programmatic resume must not auto-resume it, and must not use a staged epoch that was saved but whose activation never completed.
   - Either clear the staged epoch on reload, or keep it inert until a new trusted Continue.
   - Make sure the existing `recovering` consumers (recovery, wake scheduler, UI) treat this staging distinctly from crash recovery. They must not resume, re-dispatch, or show it as "recovering work". Enumerate every reader of `recovering` in the delta.
3. **Continuing through chat.** Stop's own notice says "Continue or send a message".
   - A real user chat Send to that paused Manager, which is already an authenticated user request block (not metadata), should mint the epoch through the **same** staged path.
   - Otherwise N5 recurs on the send path, the same way P1-B did. Mission-bar and goal-routed sends get the same treatment only when they create a real user request for that run's goal.
   - Otherwise state plainly in the UI that questions resume only after Continue.
4. **No epoch from an unrelated click.** The Continue control must be bound to that run's id via a data attribute, checked against the `id` argument. A click on another run's Continue must not mint an epoch for this one.
5. **Ordering against a concurrent Stop.** If a Stop lands between staging and activation, the epoch must not be activated. Recheck the Stop cutoff at activation and require `epoch > latest cutoff`. A failed activation must leave the run paused, not recovering forever.
   - Test: Continue → Stop during the provider probe → no usable epoch, the run stays paused, and the hold clears cleanly.

The evidence list in the contract is good. Add tests for 1–5. The final delta review covers only this seam, plus the N1–N4 repairs.
