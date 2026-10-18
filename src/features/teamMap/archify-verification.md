# Archify Team Map experiment

This is the historical receipt for the first experiment. The current revision supersedes it; see [Tree command center verification](tree-verification.md). Orbit-only changes below were restored to the original base. The older `browser-check.mjs` harness targets the previous preview; use `tree-browser-check.mjs` for the current Tree preview.

Based on `nour` at `0b758e5c8b0eee476b6ac1c92d95c320f5279363`, in the separate `HenkDz/archify-team-map` worktree. Applies Archify's role hierarchy, grouping and relationship visibility guidance directly to MonoCode's existing components; Archify's standalone renderer is not a runtime dependency.

Orbit gives the Orchestrator and project teams distinct headings and card accents, strengthens the focused project's connection, and shows continuous assignment/report lines. Those lines reuse the existing Tree edge state: queued work flows toward its owner, working progress returns to its parent, and idle/blocked branches stop. The focused member list has a shared trunk with independent branches, so opposite directions do not overlap on the trunk. Reduced motion leaves static dashed lines; filters dim their matching connections.

Tree adds project boundary outlines using its existing measured pod bounds and role accents on cards. Layout, roster, status derivations, event routes, persistence, chat actions and the Orbit/Tree choice retain their existing implementation.

Validation on 2026-10-09:

- 75 Team Map tests passed across seven files, including a new queued/working/blocked/idle flow regression.
- `tsc --noEmit` and Vite production build passed. Build retains the existing transcript highlight, mixed import and large chunk warnings.
- 12 real-browser scenarios passed with no browser errors: current-map comparison; both views in light/dark at 1440x1080; both views at 600x1050; queued flow and reduced motion; idle stopping; attention filtering; focus, view switching and a subscribed synthetic crew event; keyboard chat navigation.
- Screenshots inspected for both themes and narrow layouts. No measured card overlap or document horizontal overflow in the tested configurations.

Local preview: revised at <http://127.0.0.1:1491>, current comparison at <http://127.0.0.1:1492>. Both use the same synthetic teams, separate origin storage, and Tauri shims. Preview controls switch activity, theme and synthetic event pulses. Chat buttons demonstrate navigation rather than opening real agent chats.

Ignored preview harness and artifact-bound source hashes are in `target/archify-preview/`. Start from this worktree with `rtk proxy node target/archify-preview/serve.cjs` (add `baseline` for comparison); run browser checks with `rtk proxy node target/archify-preview/browser-check.mjs` while both servers run.

No full repository test suite, native rebuild, native/live-provider acceptance, push or merge was performed. The preview proves actual frontend component behavior with synthetic state, not behavior in the running native app. Parent worktree edits were preserved.
