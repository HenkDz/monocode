# Proposed bounded Continue generation contract — authority verdict requested

Status: reviewable design, not implemented or approved. Root explicitly requires new current-generation questions after trusted explicit Continue, while old decisions/receipts/approvals remain retired. Current b49/ce/136 are intermediate FIX-FIRST inputs. N1-N4 repairs proceed independently; this exact authority seam needs Claude verdict before final acceptance.

## Fields and defaults

- Add only optional `decisionContinuedAt?: number` to the existing OrchestrationRun, saved through its existing control store. It is a finite nonnegative safe-integer epoch milliseconds. Absence means0 (legacy behavior). Invalid retained values fail that run's load/normalization; they are never coerced into authority.
- No new DecisionIdentity field or event protocol is needed. For a Manager/Boss requester, the existing `identity.generation` becomes `max(goal.createdAt, run.decisionContinuedAt ?? 0)`. Member generation remains the existing retained current dispatch.startedAt; no turn counter substitutes for it.
- Existing old ledger/event bytes remain unchanged. An old Manager identity no longer matches after a new epoch; a member needs a fresh current dispatch generation newer than each relevant Stop. deliveryState stale, original goal/run/task/cancellation, exact requester/request binding, source text, account/home/project, roster and dispatch guards all remain mandatory.

## Every public caller and trusted ingress

Current actual callers are UI-only: ProjectManagerReview Continue, MonoTeamActivity Continue, and both accepted App AttentionQueue mounts via attention model's continue action. Existing orchestration/managerWakeRecovery and component/model tests call continueManager programmatically; no authenticated team.message/control action currently calls it.

Thread the native click Event from the two direct buttons and AttentionQueue's existing action path to `continueManager(id, event?: Event)`. Relevant buttons carry a narrowly named Continue data attribute. The epoch path requires `event instanceof Event`, `event.type === "click"`, `event.isTrusted`, and an actual originating Continue button. Real keyboard activation yields the same trusted click. JSON flags, synthetic events, reports, automation/habits, old markers and restored receipts cannot select this path. Existing programmatic calls may retain their prior resume behavior but mint no decision epoch. No user actor or protected-operation permission is created; OS presence is not inferred from isTrusted.

## Capture, persistence and publication ordering

1. At the trusted call, capture the actual bound owner session and managerRequestBinding, original run lead/owner/project/workspace, and its original goal/request associations from the existing ledger. The run must be the paused project Manager whose UI was activated. Existing scoped Stop retirement preflight must finish first. Unreadable or replaced affected original authority refuses; unrelated ledgers do not block it.
2. Probe providers using the existing flow, then recheck captured session account/home/generation/binding, run identity/owner/project, original request blocks/goals and cancellations. Any changed scope fails before new epoch publication; no fallback to new metadata occurs.
3. Use the existing Orchestrator actions/saves chains, outside any session writer or goal-ledger callback. Select an epoch strictly newer than the observed Stop/previous continuation cutoff (at least max(now, cutoff, previous)+1). Stage it using the existing `recovering:true` run flag while the run remains paused. The original decision capture already rejects recovering runs, so early in-memory commit publication cannot make unverified epoch authority usable.
4. Save via the existing store and load the run back through that store. Verify exact epoch and captured original owner/project/request scope, and recheck the live recipient/account/home/generation/original context after each await. A failed save/readback remains visibly paused/recovering with no usable new grant.
5. Only after successful readback remove the preparation flag through the ordinary serialized path and execute the existing start/resume flow. Recheck scope on action-chain reacquisition and immediately before actual publication. Provider start and a later new dispatch retain all existing approval/queue/account/home safety gates. No source hydration or ledger retirement occurs inside a held session writer.

The existing recovering flag is preparation state, not a second continuation store or authority bus. If existing start logic cannot safely preserve this staging/readback contract, implementation must be adjusted and the exact revised seam returned for verdict; it must not silently publish a usable unsaved epoch.

## Stop, reload and refusal rules

- A Stop does not create or advance continuation authority. It retires only decisions at/before its cutoff; failed retirement remains held and retried within the affected session's own scope. Historical verified markers do not re-arm holds.
- An old request followed by a Stop can raise a new question only when the trusted persisted continuation epoch is newer than that Stop AND every original authority guard still holds. A member additionally needs its actual running dispatch generation newer than the Stop; a continued timestamp never blesses an old dispatch.
- A newly committed user goal after Stop remains governed by its own real user request. No marker order or continuation epoch fabricates a user block.
- Restored old decisions and duplicate old answers are consumed-first checked only as exact already-consumed evidence; otherwise they fail stale identity/retirement checks. New continuation cannot rewrite their version, options, recipient, approval, receipt or deliveryState.
- Reload accepts only a fully readable persisted run field. A staged recovering/paused snapshot cannot auto-publish new question authority. Legacy snapshots without the field remain readable with0 and require real fresh authority before a stopped original goal can question again.

## Required evidence

Production serialized run save/readback, actual App preflight/host and original identity checks; trusted mouse and keyboard Continue from real browser UI; synthetic/programmatic/non-Continue refusal to mint epoch; fresh current-generation Manager/member questions; old answer/receipt refusal; stop-after-Continue/newer-stop refusal; same-engine/owner/project/account/home/goal replacements during each await; failed commit/readback and reload; source-bound later report delivery without manual Resume. Existing independent real session-writer regression keeps its fixed1000ms bound. Exact source and tests, sanitizer/normalizer changes and every touched caller will accompany the final delta review.
