# CC5-B: reasoning effort defaults by role

New Grand Orchestrator and Manager conversations default to medium; new workers, including Reviewers, default to high. This implements section 1 of `docs/cc2-orchestration-design.md` and the CC5-B brief. The measured baseline is `C:/Users/nooro/AppData/Local/Temp/monocode-cc/FINDINGS.md`: coordinator turns spent substantial time in sequential model calls. This change supplies gentler defaults; it does not establish a measured latency improvement.

Existing populated conversations and profiles retain their choices. Their Details controls show the effective effort and `Set by you`; role-owned choices show `Role default`. Coordinators above medium receive a reversible `Use role default (medium)` action and the explanation `coordinators route and review; high effort mostly adds latency`. Selecting effort records user ownership. Reset keeps non-effort values and unrelated locks; it clears the existing grouped `modelSettings` lock and restores role ownership.

## Resolution and lifecycle

`monoRoleEffort.ts` uses `modelEffortSetting` and `mergeModelSettings`, including providers whose effort setting is named `effort`, `reasoning`, `reasoningEffort`, `thinking`, or `variant`. Locked settings and explicit user choices take precedence, then populated legacy choices, then the role default, then the provider default. Unsupported role values keep the provider default and show an explanation. Resolution does not choose a different model/account/provider or write global preferences.

First-open resolves after generic session creation, so `preferredModelSettings` cannot inject an ordinary chat's remembered xhigh. Reopened conversations keep their saved settings. Chat reset and org habit clones retain the resident settings and source. User-selected model switches carry compatible effort across actual setting IDs without applying global remembered settings. Account cloning retains role-session settings/source; workspace stubs preserve ownership before a durable conversation record exists. The new Manager placeholder path also resolves before adoption, while loaded legacy Managers remain untouched.

Mono, Session, and worker task types have optional `effortSource: "role" | "user"`. Mono parsing validates it. Session persistence reuses the existing durable model-settings JSON with `__monocodeEffortSource`, following the existing read-only marker pattern, and strips/validates it on hydration before providers receive settings. No native database migration is needed. Existing records without metadata are retained rather than bulk rewritten.

Inferred new hires use worker role effort instead of inheriting coordinator effort. Explicit Team updates retain their effort; reconciliation and both Undo passes include source ownership with the existing concurrency and lock checks. Only coordinator `modelSettings` is added to the otherwise member-only locking behavior.

Delegation, member work requests, and automatic Reviewer tasks resolve their profiles. Worker preparation returns a cloned effective profile to the existing `session_prepared` commit. Task retries and hydration reuse that snapshot despite later roster or global-preference changes. Existing restored worker settings remain intact. Returning the snapshot through the preparation contract avoids mutating a task while checkout preparation awaits concurrent engine changes.

Both Details surfaces reuse `ModelSettingRows`. Its settings callback optionally supplies the changed setting ID, allowing non-effort edits to retain effort ownership. Live conversation controls use that Session's source, independently of later Team profile changes. The same rows work with the model-source context's advertised remote settings.

## CC5BF review repairs

Composer now forwards the selected setting ID through SessionPane to the ownership callback. Selecting the displayed effort again records a user choice and locks settings; selecting a grouped Fast or Service Tier option keeps role ownership. Details reset still supplies its explicit source independently of the setting ID.

An explicit Plan Build target effort records user ownership on the submitted Session. Once the submission is accepted, its Mono profile receives the selected settings and the settings lock. Details and catalog refresh therefore retain the selected Build effort. A target without an effort choice retains its existing ownership.

Team API harness/model switches without supplied settings use `switchMonoRoleEffort` with both advertised model profiles. Compatible user choices survive changes to the provider's effort setting ID. Translation and Undo retain an existing settings lock; explicit writes, newly added locks, and concurrent profile edits retain their conflict checks.

Worker preparation re-reads the active run after awaited checkout scope discovery, requires a running task with the same dispatch ID, and commits from that current snapshot. Cancelled or replaced dispatches cannot be revived, and unrelated concurrent tasks remain in the saved run. The submit guard also checks dispatch identity after persistence.

The committed reproductions cover the actual Composer and Build controls, App callbacks, Details display/catalog refresh, Team handler/Undo, and the deterministic cancellation preparation window. Final validation and evidence for these repairs are recorded in `docs/cc5bf-effort-fixes.md` and `C:/Users/nooro/AppData/Local/Temp/monocode-cc/cc5bf/REPORT.md`.

## Scope and alternatives

The core policy lives in a new model module and the origin/reset presentation in a small shared component. Shared-file changes are limited to necessary callers, types, persistence, preparation results, and locking. The extra habit, Manager placeholder, account/stub, Team Undo, and automatic-review paths were found by tracing session creation and required the same policy. No prompt text, goal routing, wake batching, review authority, permissions, publishing, or merge rules changed.

Rejected alternatives were changing global `preferredModelSettings`, silently migrating existing high/xhigh profiles, hard-coding one provider's effort ID, switching models to obtain medium/high, and mutating an in-flight engine task directly. Separate per-setting lock schemas and native schema migrations were unnecessary for this round.

## Validation and evidence

Final commands, exact counts, exits, durations, and raw logs are recorded in `C:/Users/nooro/AppData/Local/Temp/monocode-cc/cc5b/REPORT.md` and its `validation/` directory. All Node checks use `NODE_OPTIONS=--no-experimental-webstorage`. The package and lockfile are unchanged; a normal local `npm ci` installed dependencies.

The full suite selected all 549 files and 6,046 tests: **547 files and 6,033 tests passed; 2 files and 13 tests skipped; 0 failures**. It ran with `--maxWorkers=4` in 145.68 seconds (147.93 seconds wall time), without changing assertions/timeouts or excluding files. The change adds 67 regression cases. Raw evidence is `validation/vitest-final-results.json`, `validation/vitest-final.stdout.log`, and `validation/vitest-final.stderr.log`.

The first default-concurrency run failed five cases: one outdated unsupported-provider Effort-row expectation and four unchanged CRLF editor cases (the first timed out). The row expectation was updated; all four CRLF cases passed unchanged in a focused run, then passed in the capped full run. Both full runs and the focused CRLF JSON remain in the evidence directory. This supports a load-sensitive test timeout explanation; it is not proof of its exact environmental cause.

Fresh `npx --no-install tsc --noEmit` passed with no diagnostics in 30.24 seconds. Fresh `npm run build` passed in 57.86 seconds (Vite: 28.76 seconds). Evidence is `validation/tsc-final.result.json`, `validation/build-final.result.json`, and their raw stdout/stderr logs. Build warnings cover two `::highlight` CSS optimizations, the existing mixture of static/dynamic imports of `mono.ts`, and chunks over 500 kB. The full tests also log mocked Tauri-bridge and React `act` warnings. These checks do not establish native or provider end-to-end acceptance.

Focused coverage includes remembered-xhigh leakage, all five effort IDs, unsupported providers, locked/explicit/legacy choices, cross-provider model switches, reset/reopen, account-affinity workspace restoration, inferred hires, Team update/Undo, persistence-marker stripping, worker snapshot/retry/hydration, org habits, source labels, effective remote settings, and both reset actions. The new DOM suite tests the actual Details and Team components with synthetic storage and mocked unrelated native/provider calls.

No isolated native executable was available in this worktree (`src-tauri/target/debug/monocode.exe` and `target/debug/monocode.exe` were absent). The default Tauri identifier targets the user's real profile, so verification used DOM fixtures instead of launching it. No before/after screenshots, live model turns, native build/Cargo tests, or equivalent-goal latency/quality benchmark were run. Native code did not change. No user profile data was modified, and nothing was merged, pushed, or deployed.

Actual coordinator latency and routing quality remain to be measured under separately authorized, equal-work live samples. Existing grouped settings locks remain grouped; Reset removes that lock while preserving its non-effort values. Catalogs without the requested effort retain their provider default. These are deliberate limits rather than evidence of a measured speedup.
