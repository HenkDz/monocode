# Claude verdict: QUARANTINED-DIGEST-RECOVERY-CONTRACT

**APPROVED in direction, with 5 binding conditions.**

**What's right, keep it:**
- A host-authored ordinary notice, verified by exact read-back, followed by explicit `retiredEventIds` retirement (never a consumed acknowledgement).
- No actor, approval, start, steer, ledger or bus.
- Raw quarantine retained.
- A failed proof stays visibly held.
- The same prerequisite applies at both App acceptance and the queued consumer.
- No held writer across the steps.

## Conditions
1. **Atomic notice and retirement, or an inert notice.**
   - **Preferred:** a single Orchestrator `actions`-chain commit that appends the notice event **and** sets `retiredEventIds` for exactly the bound V2 ids, followed by `control_load` read-back of both.
   - **If you keep two steps:** the notice must be non-deliverable until the read-back of the retirement shows those exact ids retired on the **same** receipt.
   - Otherwise there are two failure modes:
     - a notice without retirement tells the Manager to re-raise while the original is still pending, which creates duplicate decisions;
     - retirement without a notice silently drops it.
   - **Mixed reports:** retirement must leave every unrelated event of that receipt deliverable, with `moreEvents` true. The next digest must contain the notice plus exactly those unrelated reports, once.
2. **No source mutation between proof and retirement.** Inside the actions chain, at the point of commit, require all of the following to equal what the notice bound:
   - the same `receipt.id`;
   - an identical `eventIds` set;
   - the same `ownerMonoId` and Manager run;
   - an unchanged recipient session generation, account, home and binding;
   - the same quarantine evidence (raw record hash).
   
   Any difference refuses, leaves the digest held, and creates no notice for the new receipt.
3. **Deterministic and idempotent.**
   - The notice id is `recovery:<receiptId>:<sha256(sorted V2 ids)>`. It must **not** match `isMonoDecisionEventId` or the CC5D `decision:report:*` patterns.
   - A retry that finds the same id with an identical body and signature is a no-op success.
   - The same id with a different body refuses and stays held.
   - At most one notice per receipt.
4. **Notice content is host text only.**
   - Allowed: the fixed template, the count, the decision ids, and a "see Decisions" pointer.
   - **No** quarantined bytes, question text, options or context, since that is untrusted and possibly corrupt.
   - It is not classified as a Mono message, question or decision. It cannot be answered, and it carries no `monoDecision` metadata.
5. **Re-raise stays fully guarded.**
   - A new decision id raised after the notice goes through the normal requester authority path with current-generation guards (and the N5 epoch rules after a Stop).
   - It never inherits the quarantined record's approvals, options, version or answer.
   - The quarantined record remains unanswerable and is shown as "unreadable, held".
   - If a re-raised decision is quarantined again, it follows the same path with no loop. One notice per receipt bounds it.

## Required tests
Add these to the contract's list:
- a mixed receipt (one quarantined V2 id plus two unrelated reports) delivers the notice plus both reports exactly once;
- a receipt or eventIds change between notice proof and commit refuses;
- an idempotent retry, and a conflicting-body refusal;
- the notice contains no quarantined text;
- a notice-saved-but-retirement-failed state (if two-step) is never delivered.
