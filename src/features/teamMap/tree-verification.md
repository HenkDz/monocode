# Tree command center experiment

Separate `HenkDz/archify-team-map` worktree, based on `nour` at `0b758e5c8b0eee476b6ac1c92d95c320f5279363`. Applies Archify layout guidance directly to MonoCode components. No renderer dependency was added.

Tree uses one stable orientation: Orchestrator above project columns, Manager above a single worker stack. Larger cards show identity, status and a task with up to two lines; model/permissions/report details remain in the tooltip. Shared connectors stay subdued; active direction animates only on independent branches, avoiding opposite animations overlapping on a shared trunk. Existing state, lifecycle and event derivations remain the source of truth.

Drag a project header to move its whole column, or use Alt+Left/Right on the header. Saved project order reuses the existing Orbit preference store; resizing, filtering and Arrange preserve it. Arrange restores the default readable layout and scroll position; Fit to view deliberately scales the whole map to its viewport. Default cards stay at 100% with scrolling, including when the preview conversation panel opens. Narrow screens use the existing ordered vertical hierarchy. Project headers focus their team; every agent card opens its chat through the existing callback.

The isolated preview also demonstrates a contextual conversation panel with organization/project/worker scope, Ask/Assign tabs, and per-agent local messages. **That panel and its composer are a preview-only simulation in the ignored harness. They are not integrated with native chat or live assignment routing.** Native card clicks retain the existing chat-navigation callback. The revised Tree accepts controlled selection callbacks for the preview; keyboard navigation follows that selection, while Escape can dismiss the panel without clearing it.

Latest UX revision: project groups and node borders are neutral; working status is subdued, attention stays amber, and selection uses a distinct neutral outline plus the blue reporting chain. Cards have one status indicator and no repeated role subtitle. Project columns are narrower, with neutral letter markers; Undo restores the previous saved order after drag or keyboard moves. Arrange keeps order and restores readable geometry; Fit to view explicitly scales the whole diagram.

The preview shows an unambiguous full target (for example, `MonoCode › Engineer`), keeps a draft and Ask/Assign mode per agent, and labels its local messages as not delivered. Context details are collapsed. Sample approval/request-changes controls are explicitly simulated and never claim a real submission. The selected card stays visible when the panel opens; at narrow widths the panel stacks below the map rather than covering it. Preview debug controls are collapsed by default.

Validation on 2026-10-09:

- 80 focused Team Map tests across eight files passed, including ownership preservation, stable geometry across resize, routes avoiding all card interiors, drag persistence and Undo, keyboard reordering, controlled selection/dismissal, and Arrange retaining order.
- `tsc --noEmit` and production build passed. The build retains its existing transcript highlight, mixed-import and large-chunk warnings.
- 14 Chrome scenarios passed with zero browser errors: readable default geometry; actual drag/drop, Undo and persisted order after reopening; Arrange preserving reporting relationships; keyboard reorder; Orchestrator Ask; Manager Assign; worker selection; separate drafts/modes and Escape/arrow navigation; selected card visibility; simulated decision honesty; queued/idle/reduced motion; attention and subscribed event pulses; light theme; desktop scrolling and narrow list.
- Dark/light, panel and narrow screenshots were inspected. No card overlaps or document horizontal overflow occurred in tested layouts. Desktop cards remained 256px wide when the panel opened and at a 900px viewport; the map itself scrolls.

Revised preview: <http://127.0.0.1:1491>. Current-map comparison: <http://127.0.0.1:1492>. Both use synthetic teams, separate browser origins/storage and Tauri shims; they do not mutate the real roster or contact agents.

Ignored harness: `target/archify-preview/`. Start `rtk proxy node target/archify-preview/serve.cjs` (add `baseline` for the comparison); run `rtk proxy node target/archify-preview/tree-browser-check.mjs`. Latest screenshots and source hashes: `target/archify-preview/recommended-evidence/`. The receipts bind the actual preview TSX/CSS as well as the Tree source files.

No full repository suite, native rebuild, real-provider run, push or merge. Parent worktree edits remain untouched. Earlier Orbit-only styling and flow changes were restored to the original base so the final proposed merge is scoped to Tree.
