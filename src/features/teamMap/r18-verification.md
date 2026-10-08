# R18 Orbit verification

Orbit is the default Team map. Project capsules keep their alphabetical or saved order across resizing, rotate by the shortest direction to six o'clock, and unfold one status-sorted team. Order, focus and the Tree toggle persist. The center shows the Orchestrator's own session status separately from work below. Both views preserve model colons and specialty casing, with specialty ellipsis and tooltips. Existing navigation wiring, crew feed and lifecycle/status derivations are reused.

Implementation and evidence are confined to `src/features/teamMap/**` on `HenkDz/r18-orbit`, based on `b20202d`. App, PR tracking, source-control, session and native source files were not changed. No dependency was added; tests reused installed dependencies through an ignored junction after verifying identical package-lock hashes.

Frontend validation passed on the final source:

- Full suite: **5,363 passed, 13 skipped; 504 files passed, two skipped**, in 162.08 seconds. The skipped tests are the existing Antigravity Real and Soak suites. No failures occurred.
- Team map: **74 passed across seven files**, including **11 Orbit UI** and **13 Orbit model** tests. Coverage includes fixed ring order and placement, shortest rotation, attention/scoped/saved focus, persisted drag order, sorting, paging beyond eight, keyboard chat navigation, own Orchestrator status, reduced motion, model text and specialty casing. Retained Tree tests also passed in the full run.
- Standalone `tsc --noEmit` and `npm run build` passed. Existing build warnings concern transcript `::highlight` CSS, mixed static/dynamic imports and large chunks.

The full suite ran through `rtk proxy node target/r18-checks/run-frontend.cjs`, which sets `NODE_OPTIONS=--no-experimental-webstorage` and launches `vitest run --maxWorkers 4 --testTimeout 15000` for Windows Git integration tests. No repository timeout setting or assertions were weakened. The full log remains local at `target/r18-checks/frontend.log`.

The [browser receipt](evidence/r18-orbit-live.json) records **21 scenarios**, zero browser errors, no settled capsule/center overlaps and no horizontal overflow at widths 600, 800, 1200 and 1600. All five recorded source SHA-256 hashes were independently checked against the final worktree. Checks include rotation, resize without reorder, filtering, keyboard actions, persisted focus/order, Tree switching, paging, reduced motion and event routing through the real crew-message subscriptions. The focused team scrolls vertically when the viewport cannot show every row.

The preview launched outside Git from the isolated empty folder `C:/Users/nooro/AppData/Local/Temp/monocode-r18-orbit-evidence`, with identifier `com.monocode.r18.orbit-evidence`, a separate browser profile and Tauri shims. It replayed a read-only snapshot of the user's roster and saved runs: four projects, four dzdistro members, three browser-link-4 members and two empty teams. Prompts, transcripts and report content were omitted. Saved session data does **not** establish live busy status.

Screenshots: [user org dark](evidence/r18-user-org-dark.png), [user org light](evidence/r18-user-org-light.png), [dzdistro team](evidence/r18-user-dzdistro-team.png), [browser-link-4 team](evidence/r18-user-browser-team.png), [eight projects at narrow width](evidence/r18-eight-projects-narrow.png), [reduced motion](evidence/r18-orbit-reduced-motion.png). Three-frame sequences capture [rotation](evidence/r18-rotation-1.png), [goal along a spoke](evidence/r18-goal-1.png), [task drop](evidence/r18-task-1.png) and [report return](evidence/r18-report-1.png); matching `-2.png` and `-3.png` files show later frames.

These are actual-component browser checks with a replayed user snapshot and synthetic animation events. **Native desktop and a new real-provider delegation were not exercised.** The user's running app and projects were left untouched; the preview service and browser contexts were stopped. No Rust suite/native rebuild, push, merge or deployment was performed.
