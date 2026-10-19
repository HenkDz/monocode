# Claude final review — CC-VISION V2 decision data foundation

**Exact:** `f31f4288ed06c0227629c110e0df1ccf9af71d37`, tree `d5c0d7b993dfd532fb6e9308294cdb05abe85fcc` (base `8232734e`).
- **Scope:** `monoDecisions.ts`, `monoDecisions.test.ts` and `monoManagerGoals.ts` (+39). No native, App or UI change.
- **Reviewed:** the full source, read by Claude.

**Verdict: CLEARED FOR INTEGRATION as the data foundation**, conditional on the builder's pending tsc/build/full-suite gates being green at this exact pin. There are 2 P2 items **for the V2-UI/wiring stage** (not blockers for this foundation) and 2 P3s.

## The 8 contract requirements: all met in source
1. **Single home:** `handleDecisionCommand` refuses unless `host.current().run.ownerMonoId === ownerId` (the originating Manager's ledger), via the existing `serial` writer.
2. **Trusted answers:** ingest accepts only `question`/`escalation` from the authenticated actor equal to `message.senderId`, and strict JSON rejects status/answer fields. Resolve requires the current chain level. The host actor is cloned before the async work.
3. **Impact floor and protected classes:**
   - `raise-impact` can't lower, and the stored impact can't fall below the source impact on reload.
   - `bossMayDecide` allows only `operation === "work"`.
   - Managers may resolve only low-impact work below the threshold.
   - "everything" sends every decision to the user, and delegation is user-only and work-only.
4. **Bounded history:** pending/delegated decisions are always kept; the last 200 decided are kept and the rest counted in `decisionsPruned`. The log caps at 256 entries per decision. The 7 MB and 4,000-receipt caps are retained.
5. **Exactly once:**
   - event IDs are `decision:<id>:<version>:<kind>:<index>`;
   - the receipt is retained until delivery succeeds;
   - stale authority becomes `deliveryState: "stale"`, with no delivery;
   - a stale user resolution is recorded without delivery.
6. **No auto-decide:** reminders are explicit, logged actions by the Boss only.
7. **Shared Boss rule:** `bossMayDecide` is exported for the runtime and prompts.
8. **Hygiene:** caps of 300/2000/6×240/6000 characters; text is retained as plain strings; nothing executes; no telemetry.

## P2: for the V2-UI/wiring stage
- **P2-1, autonomy requires a live goal snapshot.** The `autonomy` command validates against `host.current().goal.projectId`, so a project with no active goal can't have its "Ask me for" setting changed, while the approved UI shows that control on every project drawer. Fix in wiring: validate that the project belongs to this Manager's projects (roster), and don't require a goal.
- **P2-2, one corrupt decision blocks the whole Manager ledger.** `validateDecisionHistory` runs on load and save. An invalid present record throws, so every goal operation for that Manager fails, not just decisions. That's safe (fail closed, nothing overwritten) but harsh. Before wide use, add a quarantine path: preserve the raw invalid entry aside, mark it unreadable in the UI, and keep goals working. Alternatively, state explicitly that this matches the existing CC-GOAL ledger policy and surface a repair action.

## P3
- `operation` is self-declared by the requester. A mislabelled merge as "work" could be decided by a Manager or the Boss. That's acceptable only because **decisions never execute operations**: the real merge, install and sign-in paths keep their own user approvals. Keep it that way, and in V4 derive the class from the structured action the Mono is requesting.
- `remind` delivers to recipient `"user"`; the host must map that to a UI notification, never to a Mono.

## Next
1. Integrate after the green gates.
2. V2-UI / V3 must consume `bossMayDecide`, handle P2-1, and render decision text as plain text nodes (as the foundation assumes).
3. Claude reviews the wiring stage where it touches the host delivery or authority.
