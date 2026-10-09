# Team orchestration manual acceptance checklist

## Orchestrator-to-Manager delegation

- [ ] Have the Orchestrator use `goals.assign` to delegate a goal to a direct Manager.
- [ ] Verify the assigned goal is scoped to exactly one project.

## Member task cards

- [ ] Have the Manager call `control delegate` with an explicit member id.
- [ ] Verify the app supplies that member's configured model and identity.
- [ ] Verify the delegated task appears as a card scoped to specific files.

## Reviewer exact-dispatch approval

- [ ] Delegate the Reviewer with `reviewTaskId` naming the exact completed implementation task.
- [ ] Have the Reviewer independently read the diff and check the implementation before calling `reviews.submit` with a real decision.
- [ ] Verify approval unlocks the PR gate only for that exact dispatch, not another task or a later dispatch.

## Activity / Needs-you surfacing

- [ ] Verify blocked approvals and questions surface to the user as Needs-you items.
- [ ] Verify paused runs surface as Needs-you items and are not auto-resolved.
- [ ] Verify approvals and questions remain pending until the human user responds.

## Human-only PR merge

- [ ] Verify the Manager and Reviewer can open and approve a PR within their assigned authority.
- [ ] Verify only the human user can merge the PR; no agent performs the merge.
- [ ] Verify no agent deploys or deletes retained work during the workflow.
