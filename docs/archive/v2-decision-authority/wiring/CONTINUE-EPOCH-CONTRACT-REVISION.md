# Minimal staging revision for verdict — no implementation yet

This revises only staging in CONTINUE-EPOCH-CONTRACT.md, accepting all five additions in CLAUDE-CONTINUE-EPOCH-VERDICT.md. Inspection shows `recovering` already drives automatic recovery, wake eligibility and user-visible recovery/Continue controls. A numeric active epoch plus recovering cannot distinguish a later ordinary crash of an already continued run from an incompletely activated epoch without changing existing crash behavior. I therefore request the smallest explicit pending discriminator in the **same existing run**, rather than overloading recovering.

## Revised retained fields

- Keep approved `decisionContinuedAt?: number`: active authority epoch, finite nonnegative safe integer, absent0.
- Add only `decisionContinuePendingAt?: number`: staged but unusable epoch, same validation. Absence means no staged activation. It is never read as active generation.
- Pending requires paused status and recovering absent/false during normalization, hydration and activation failure. It remains visibly paused with an activation-not-completed notice and permits a fresh explicit Continue/user Send; it is not crash recovery. No new store, identity/event field, actor flag or durable message bus.
- The active epoch remains unchanged while pending is saved/read back. After exact stage readback and all live/Stop checks, a serialized activation commit sets active=pending and removes pending. Read activation back before allowing provider publication or new decisions. Keep the original run paused during these commits; only then use the existing start path. Original work capture also explicitly refuses pending state, so an unsaved/failed active publication cannot become usable.
- If activation readback fails, keep or restore a paused pending state with visible failure; no automatic resume. On reload, pending remains inert and blocks programmatic start/continue until a fresh authenticated action completes the same staged path. The epoch must exceed latest Stop and previous active/pending cutoff; concurrent Stop invalidates activation and leaves paused. This avoids an endless recovering flag.

## Every existing recovering consumer inspected

| Consumer | Preserve existing behavior / new pending protection |
| --- | --- |
| Orchestrator.hydrateRun (`recoverManager`, automatic enable/recovery) | Explicitly exclude pending runs from automatic recovery; retain paused pending snapshot and notice. Do not confuse it with the interrupted-run error recovery case. |
| Orchestrator recovery scheduling/pump/start/commit paths | Normalization preserves paused pending state; public programmatic start/continue refuses pending. Only private verified activation clears pending. Existing non-pending crash recovery remains unchanged. |
| managerWake.reconcileManagerWake and scheduler | Pending is ineligible for delivery/turn start; preserve raw events/receipts. No digest acknowledgement or new continuation from pending. |
| projectManager selector and MonoTeamActivity selector | Show paused activation failure/explicit Continue, not recovering work; no new automatic action. |
| ProjectManagerReview header/count/Continue visibility | Same explicit paused UI, with actual trusted control bound to run id. |
| monoDecisionRuntime candidate selection and monoDecisions.captureIdentity | Reject pending regardless of active field; retained original task/dispatch/request/binding checks stay. |

Repository search of recovering readers/writers in orchestration/model/ui, monos/model, App and shell found the above production families. Exact changed functions and all post-await readbacks will be bound to the next source pin.

## Five required additions retained

1. Trusted Event must be a recent real click (few-second bound), originate from the actual Continue control whose data-run-id equals the requested run, and be consumed once via WeakSet. Synthetic, stale, replayed or unrelated-run events mint no epoch. Mouse and keyboard real clicks are tested.
2. Pending reload is paused/inert and cannot auto-recover/redispatch. Non-pending crash recovery is preserved. Programmatic callers cannot clear pending or use staged epoch.
3. Choose the real-Send path: the actual App user submission boundary may call the same staged routine only after a committed/read-back non-internal isManagerUserRequest block and existing authenticated user origin, excluding managed/event/habit/automation paths. Bind original session, run and goal/request scope. Record its one-use request identity/signature in existing run.requests, making exact retries idempotent. Mission/goal-routed requests qualify only after the corresponding real user block/goal binding is durable. No epoch is created from plain text, metadata assertions or an old user bubble.
4. Every actual Continue UI caller threads its native Event and binds the control to that run id. Existing legacy programmatic resume without a trusted event keeps prior behavior only when no pending continuation/Stop requires fresh authority; it mints no epoch.
5. Recheck latest Stop cutoff, recipient generation/account/home, original owner/project/goal/request and receipt on stage save/readback, action-chain reacquisition, activation save/readback and immediately before provider publication. A newer Stop refuses activation and leaves paused, without endless recovering.

For Manager/Boss, reuse existing identity.generation=max(goal.createdAt, active epoch). Members still require actual fresh running dispatch.startedAt newer than the relevant Stop; an epoch never blesses old dispatches. All old source versions/answers/receipts remain stale and protected operations still require their original user approval.

Required connected evidence stays as in the original contract plus all five additions, both user paths, native save/readback failure and pending reload refusal, original-context replacement races, and unchanged1000ms real-writer regression. This remains a proposal pending exact authority/persistence verdict; N1-N4/P3 work continues independently.
