# Claude verdict: CONTINUE-EPOCH-CONTRACT-REVISION

**APPROVED, with 4 binding conditions.**

The separate `decisionContinuePendingAt` discriminator is the right call: overloading `recovering` would have changed crash recovery. The consumer table is complete enough to bind to the next pin. Keep:
- pending is never read as active;
- staged values are paused and inert;
- automatic recovery, wake and start refuse pending runs;
- non-pending crash behavior is unchanged.

## Conditions
1. **The window between the activation commit and its read-back.** The in-memory commit sets active=pending before the disk read-back, so in-memory state alone must not make that active epoch usable.
   - `captureIdentity`/candidate selection must refuse **paused** Manager runs, not only pending ones, so no question is minted while the run is paused at any point of activation.
   - Hold a non-persisted in-memory "activation in flight" guard until the read-back succeeds. Clear it only before calling the existing start path.
   - A paused run with an active epoch must **never** auto-start on reload, recovery or wake. Only a trusted action starts it. That makes a "save succeeded, read-back failed, then the app crashed" disk state harmless.
   - Test: a question from the Manager between the activation commit and the read-back is refused.
2. **Latest-Stop cleanup.** A Stop that lands while a continuation is pending durably **clears** the pending value, or marks it superseded, as part of its own retirement save.
   - A pending value ≤ the latest Stop cutoff is ignored everywhere, and **does not** keep blocking later legitimate starts forever.
   - Test: Continue → Stop mid-probe → reload. The run is paused, nothing is pending, and a fresh Continue works.
3. **User-Send provenance must come from the gesture, not from block role.** A Manager chat can receive user-role blocks from paths other than the user's own composer (peer `sessions.send`, goal routing, restores, imports).
   - The Send path may mint only when the App submit boundary was entered from a **trusted composer gesture**: the Send click, or Enter, as a trusted keyboard or click Event, using the same one-use WeakSet and recency check as Continue.
   - It must be bound to that session and run, and happen after the committed and read-back user block.
   - Never mint from block role or `isManagerUserRequest` alone.
   - Mission bar and goal-routed sends follow the same rule: a trusted gesture, and a durable user block or goal bound to that run.
   - Test: a peer `sessions.send` and a restored user bubble mint nothing.
4. **Idempotency scope.** Use the `run.requests` entry for exact retries of the same gesture only. A second distinct trusted gesture after a newer Stop must mint a new epoch, so a reused request id cannot reopen an older epoch.

The final delta review covers this seam plus N1–N4. Bind the exact changed functions and every post-await read-back.
