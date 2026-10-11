# CC1F: reliable context delivery and offline rules

Branch: `HenkDz/cc1f-prompt-fixes`, starting from `nour` at
`8352c883da301d1df377a306e159e5fe00d87304` with CC5-A included.
Merge `416d2f1125ced9a18e97c5cb361ef76a87607c42` integrates CC1
`7524d6ba3d8e449e27bf76fa5e0683463afde593`. The sole merge conflict was
the adjacent native test groups; both groups were preserved.

CC1R reproduced a replacement OpenCode conversation receiving a prompt
without org, soul or memory, then acquiring false delivery receipts. CC1F
rebuilds context after the adapter resolves its conversation and before
serializing the prompt. OpenCode, Codex, Pi/OMP, Claude and all registered ACP
providers use the same optional preparation hook. The App also builds a full
fallback first, so an adapter without the hook cannot silently omit context.
Unknown continuity always receives full context. Pi/OMP cannot treat a saved
resume hint as proof; Claude needs an actual main-conversation stream ID.

Acceptance tracks binding events synchronously rather than consulting queued
React state. Omitted or partially omitted plans cannot record a replacement
provider as having received their missing blocks. Restored receipts require
one accepted full delivery in the current process before omission. Failed
storage writes never restore trust in invalidated persisted receipts.

Every Mono, member and habit turn carries a deterministic authority core,
including repair and steady turns. The fixture's Grand Orch/Manager/member
cores are 399/391/385 characters; identity fields are bounded to 64 characters,
keeping the whole core within 700 characters. It retains identity, role,
reporting line, current-user priority, user-only merge/destructive approval,
untrusted evidence, stable retry IDs and injected-CLI/prior-shell-read rules.
Prompt version is 26. The final before/after table is in
`docs/cc1-prompt-diet.md`; steady context is 857–871 characters, capped at
1,000. Existing budgets measure the context region before the unchanged
registry CLI suffix, not total provider input. First/rotation caps remain
12,000/26,000; saturated delegation/review caps are 9,500/12,500 to include
the authority core.

Offline `app rules <topic>` reads now use the checked CC5-A output path and
verified-executable automatic approval. Both approval paths accept only six
known topics, without extra arguments, flags, paths, chaining or proxies.
The constrained PowerShell grammar accepts the literal `rules`; native
executable and shell checks remain. The credential action validator rejects
rules, preserving the offline-only route. Missing stdout returns a controlled
failure; no credentials or retry IDs are needed for a local Markdown read.

Memory selection removes both supported leading strike forms before deciding
what fits, retaining live undated replacements. The rollout analyzer selects
usage fallback per turn and pairs compactions by normalized time and compatible
identity, including pairs where only one side supplies an ID. Different
explicit IDs and records without timestamps remain distinct.

## Decisions

- Rebuild before submission instead of invalidating after a fresh prompt;
  late invalidation cannot fix the first model input.
- Use in-process delivery proof instead of introducing a durable history
  generation that providers/storage cannot currently guarantee.
- Reuse the current parser, executable/shell checks and checked writer;
  do not broaden credential actions or add another output implementation.
- Keep a fixed authority core on every turn rather than relying solely on
  receipt-driven omission during compaction.
- Filter superseded memory before selection without changing stored history.
- Choose analyzer accounting per turn rather than discarding an entire
  recording family from a mixed history.

## Validation

Windows; Node 26.5.0, npm 11.17.0, Python 3.12.10, Cargo 1.92.0.
Web checks used `NODE_OPTIONS=--no-experimental-webstorage`.

| Check | Result | Time |
| --- | --- | ---: |
| Full `npx vitest run` | 550 files passed, 2 skipped, 0 failed (552); 6,039 tests passed, 13 skipped, 0 failed (6,052) | 38.31 s runner; 39.844 s wall |
| `npx tsc --noEmit` | Exit 0, no diagnostics | 17.890 s wall |
| `npm run build` | Exit 0; Vite production build passed | 20.16 s Vite; 38.922 s wall |
| `cargo test --lib control_cli::tests` | 23 passed, 0 failed/ignored/measured, 615 filtered | 0.46 s runner; 88.360 s wall |
| `cargo test --lib control::tests` | 11 passed, 0 failed/ignored/measured, 627 filtered | 0.00 s runner; 13.468 s wall |
| Focused provider/registry run | 14 files / 410 tests passed, 0 failed/skipped | 7.63 s runner |
| Focused approval run | 1 file / 38 tests passed, 0 failed/skipped | 2.453 s wall |
| Initial context/receipt run | 4 files / 35 tests passed, 0 failed/skipped; final full run includes the later long-identity assertion | 3.59 s runner |
| Analyzer self-test and CC1R accounting reproduction | Exit 0; calls `[1,1]`, compactions 2, affected turns 2; 13 identity representations resolve to 8 events | Recorded logs |
| Source stability / whitespace / touched Rust formatting | 1,323 captured source files unchanged across full web checks; diff check passed; only touched Rust file formatted | Recorded receipts |

Existing Antigravity integration/soak tests account for the 13 skipped tests.
Dependency installation added 425 packages and audited 426 successfully;
nine existing audit advisories and build/test warnings were retained.
Two development runs failed only in new mock fixtures (8 failures each:
missing Pi RPC cancellation stub, then missing `rules` in registry allowlists).
Both were corrected before the passing focused and final full runs.

## Evidence and limits

Program root: `C:/Users/nooro/AppData/Local/Temp/monocode-cc/`.

- Baseline and reproductions: `FINDINGS.md`, `cc1r/REPORT.md`,
  `cc1r/evidence/receipts/receipts-repro.test.ts`,
  `cc1r/validation/accounting_repro.py`, `cc5ar/REPORT.md`.
- Final checks: `cc1f/validation/web-summary.json`, `vitest-full.json`,
  each command's stdout/stderr/status files, native control receipts,
  `analyzer-self-test.log`, `accounting-repro.log`.
- Provider evidence: `cc1f/evidence/continuity-vitest.log`,
  `continuity-validation.json`, `continuity-report.md`.
- Independent source checks: `cc1f/validation/root-review.md`,
  `continuity-review.md`; these are source/regression reviews, not live proof.
- Final fixture sizes: `target/cc1-verification/after.json`.
- Branch, commit and complete file inventory: `cc1f/REPORT.md`.

No live model turn, desktop preview, real-profile mutation, push, deployment,
installer/release build, macOS/Linux native compilation, full native suite,
Clippy or repository-wide formatting was performed. No other branch or
worktree was changed. Corruption-specific Codex resume wording and an
additional ACP hook-specific fixture were deliberately not added; the shared
fallback path and existing ACP suites were checked. Unproved continuity and
unwritable receipt storage conservatively resend full context. Live provider
acceptance and latency improvement remain for coordinator acceptance.
