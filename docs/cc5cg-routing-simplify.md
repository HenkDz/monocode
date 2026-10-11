# CC5C-G: simplify routing and unify session persistence

CC5CF-R found three remaining failures: a path alias into another project could route to the wrong Manager, ordinary autosave could remove a saved goal origin, and floating acknowledgement errors could retry uncertain work with fresh IDs. CC5C-G closes those boundaries while retaining user-only New goal authority, Manager ownership, receipts, approvals and publishing rules.

The worktree started at `4a86188dba99a580814fbd8fa6f1e97a44bebdee` on `HenkDz/cc5cg-routing-simplify`. The implementation and tests are committed as `8b0e918c0470900c180bcc49031addcd5ac5e1d8`. Required checks ran on that clean source commit; this document is a later documentation-only change.

## Changes and decisions

Automatic routing now requires an exact, unique registered project name and no paths or path-like tokens. Slash/backslash paths, drive prefixes, dotted filenames, dotfiles and standalone dot/dot-dot tokens choose Grand. Registered-root/descendant containment matching was deleted. The physical junction, nested-junction and `..` reproductions now invoke Grand once and create no Manager goal or delivery. An explicit project chip can route path-bearing work with `Contains file paths: routed to <project> because you selected it`. Existing textual project-conflict, comparison, attachment and availability guards still apply. The route decision plus reason API is unchanged.

`sessionStore.writeSession` extends the existing per-session queue to cover snapshot construction, persistence and publication. Its supplied save callback writes directly inside that boundary, avoiding recursive queue waits. The separate `monoGoalUpdates` queue was deleted. Goal origin/card/pending updates, direct App persistence, immediate queue/new-turn saves and the deferred autosave callback now share the store boundary. Deferred autosave reuses ordinary persistence and selects current state when its queued operation runs. Intentional permission, worktree, handoff, queue-receipt and card mutations apply to current state inside the boundary.

Load-time transcript repair and its Mono baseline-cache update also run inside the boundary. Archive, live-transcript, quit/unload and busy-window close writers obtain current state through getters, including after a confirmation dialog. Historical repair retains its full-history baseline and live-page cache. Missing route cards insert after their visible user origin, preserving a concurrently appended ordinary turn; existing cards retain their positions and hidden origins retain the append fallback.

`monoSubmissionAcceptance` distinguishes accepted, proven rejection and uncertain failure for both composers. Only a host's explicit false goal rejection receives the floating bridge's rejection marker. Other goal errors propagate through FloatingMonoChat and preserve the original request/user IDs, envelope, draft and chip. The native bridge already preserves error strings, so no native protocol or App/SessionPane callback signature change was needed. MonoComposer edits remain local to acceptance handling.

Rejected alternatives: realpath/junction/dot-segment matching, filesystem reads in routing, another queue of prebuilt snapshots, another scheduler or goal ledger, a native schema/protocol change, fresh rerouting after unknown errors, new dependencies and broader composer restructuring.

## Validation and evidence

Windows; Node 26.5.0, npm 11.17.0, Vitest 3.2.7. All Node checks used `NODE_OPTIONS=--no-experimental-webstorage` and RTK. `npm ci` used the unchanged lockfile.

| Check on implementation commit | Result | Tool / wall duration |
| --- | --- | --- |
| Full `npx --no-install vitest run --maxWorkers=4` | **7,103 passed, 13 skipped, 0 failed**, 7,116 total; **593 files passed, 2 skipped, 0 failed**, 595 total; exit 0 | 95.40 / 96.700 s |
| Combined persistence/recovery/lifecycle subset | **129 passed, 0 skipped/failed; 11 files passed**; exit 0 | 2.41 / 3.755 s |
| `npx --no-install tsc --noEmit` | No diagnostics; exit 0 | Not emitted / 15.539 s |
| `npm run build` | Passed; exit 0; existing CSS/import/chunk warnings | Vite 24.92 / 44.929 s |
| `npx --no-install playwright test tests/browser/cc5c-routing.spec.ts` with isolated external config | **8 passed, 0 skipped/failed**; Chromium/WebKit, embedded/floating, dark/light, automatic path fallback and explicit path reason; exit 0 | 35.1 / 36.718 s |
| Whitespace and browser cleanup | `git diff --check` passes; zero owned preview processes or port-1441 listeners | Not measured |
| Focused Cargo | Not applicable; no native changes | — |

The 13 skips belong to existing Antigravity real/soak suites. Counts from focused checks overlap the full suite. Additional implementation-slice checks passed 199 routing/composer tests in four files and 41 floating/composer tests in seven files. The busy-close regression failed before its fix (20 passed, one failed), then all 21 lifecycle tests passed. An initial routing slice run had one outdated floating rejection-message expectation; it was corrected to the explicit rejection marker. Final required checks passed without weakening assertions or timeouts.

Evidence root: `C:/Users/nooro/AppData/Local/Temp/monocode-cc/cc5cg/evidence/`. Required-check logs and JSON receipts are `focused-persistence`, `vitest`, `tsc`, `build` and `playwright`; source/cleanup receipts and `validation.md` record the exact commit and isolated browser environment. `routing-summary.md`, `floating-summary.md` and `persistence-boundary-audit.md` explain the focused evidence. `focused-persistence.log` records the actual App callback reproductions, native suffix payloads and memory/disk identities. Browser screenshots are under `browser-results/`.

The browser fixture runs from an isolated empty folder on port 1441 with CODEX_HOME and all ORCA variables removed and synthetic projects/native calls. Chromium embedded dark Auto and WebKit floating light path override screenshots were inspected: routing controls and reasons are readable with no layout overflow. All owned preview processes stopped.

## Limits and follow-ups

Path-like prose conservatively chooses Grand; an eligible explicit chip is available. Full-history recovery polling and its existing first-failed-receipt starvation remain separate follow-ups from the review. No performance index or recovery scheduler change was added.

Native desktop/floating lifecycle, real storage fault injection, live provider dispatch and production latency were not exercised. Tests establish source, frontend persistence and synthetic/browser behavior. No real user data, other worktree, dependency, native source, upstream integration, push, merge or deployment was changed.
