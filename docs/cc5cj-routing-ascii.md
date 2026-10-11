# CC5C-J: raw ASCII-only Manager routing

Direct Manager routing now requires the entire raw goal to contain only printable ASCII (U+0020–U+007E), tab, LF and CR. Auto and selected project chips use the same gate before trimming, normalization, conflict matching or path overrides. Bidi controls, zero-width characters, non-ASCII digits, letters, emoji, compatibility forms and other ASCII controls send the goal to Grand with `Contains non-English or special characters, so Grand Orch will route it.` A selected registered project name must also pass the gate.

CC5CI-R demonstrated wrong Manager deliveries from reversed visual names, fourteen non-ASCII decimal digit blocks and entirely Cyrillic lookalike tokens. Character refusal closes those three families without another normalization table or a rendering/markup parser. Existing ASCII substring conflicts, markup refusal, path handling, Manager availability, identity checks and durable receipt/recovery behavior remain in the shared resolver and submission adapter. See [the final routing rules](cc5c-routing.md).

The embedded/floating composer, route chip and Mission command bar pass raw drafts into that shared decision. Goal callbacks carry raw text through the adapter; ordinary Chat retains trimming. Retained-envelope signatures also use raw text, so a whitespace-only special-character edit creates a fresh request rather than retaining a Manager chip. Allowed ordinary whitespace is trimmed after the gate for the submitted-goal length check, preserving the previous composer behavior.

The trade-off is intentional: a single-project goal with non-English prose, a smart quote, an accent or emoji reaches Grand even after selecting a Manager. A non-ASCII registered name also requires Grand. The fixed twenty-goal review sample still produces **16 Manager / four Grand** decisions, above the fourteen-goal requirement; this is a convenience sample rather than a production route-rate estimate.

## Regression coverage

- Ported all **38 CC5CI-R resolver rows in both modes (76 checks)**, retaining ASCII numeric-name, CRLF, overlapping-name, long-input and other safe controls.
- Ported all five connected wrong-Manager submissions through the installed Composer/SearchableSelect, shared adapter, sanitizer and real `MonoManagerGoals` ledger. Existing plain-conflict controls remain. Each checks a Grand envelope, no Manager IDs, one Grand callback, zero deliveries/goals and no persisted Manager origin.
- Exhaustive generated property checks inject every code point from U+0080 through U+10FFFF, including lone surrogate values, into a project goal at deterministic varied positions. Both Auto and explicit chips must reach Grand: **2,227,968 generated decisions**.
- Other controls except tab/LF/CR, non-ASCII registered names, trim-removable leading/trailing NBSP/BOM/line separators, raw-draft edits after uncertain sends and allowed ordinary whitespace have focused checks.
- Chromium and WebKit exercise embedded/floating widths and dark/light themes, check the reason in both routing modes, submit a special-whitespace goal to Grand, then verify the existing ASCII explicit-path route remains eligible.

## Validation and evidence

Windows / Node 26.5.0, npm 11.17.0, Vitest 3.2.7, TypeScript 5.8.3, Playwright 1.63.0; all Node checks use `NODE_OPTIONS=--no-experimental-webstorage`. Installed the existing lockfile without package changes.

| Check | Result | Duration |
| --- | --- | --- |
| Full `npx --no-install vitest run --maxWorkers=1` | **7,861 passed, 13 skipped, zero failed; 7,874 total. 622 files passed, two skipped, zero failed; 624 total.** | Vitest 466.75 s; wrapper wall 469.0649233 s |
| Focused routing/composer/retry/command-bar subset | **444 passed, zero failed/skipped; seven files passed** | Vitest 19.80 s |
| `npx --no-install tsc --noEmit` | Exit 0, zero diagnostics | Wall 23.339416 s |
| `npm run build` | Exit 0; existing CSS/import/chunk warnings retained | Vite 20.82 s; wall 45.0112166 s |
| `npx --no-install playwright test tests/browser/cc5c-routing.spec.ts` with isolated external config | **Eight passed, zero failed/skipped/flaky; 40 screenshots** | Playwright 40.723307 s; wrapper wall 42.0296047 s |
| `git diff --check` | Passed | Not separately timed |
| Focused Cargo | Not applicable; no native changes | — |

The 13 skipped tests are existing Antigravity real/soak cases. Counts overlap and are not additive. The full suite ran once; no assertion, timeout or failure result was changed. Browser checks ran from an initially empty external folder with identifier `com.monocode.cc5cj.validation`, port 1467, synthetic IPC/projects and no `CODEX_HOME` or `ORCA_*` variables. No native application or model turn was started.

The original CC5CI-R adversarial suite also passes unchanged: **85 passed, zero failed/skipped; one file**, Vitest 2.27 seconds / runner wall 3.9324729 seconds. Its copied fixture changes only imports, mocks and output/config paths; the adaptation diff preserves all original assertions.

Evidence root: `C:/Users/nooro/AppData/Local/Temp/monocode-cc/cc5cj/evidence/`. `focused.log` and `focused-results.json` capture the focused run; `reviewer-probes/` holds the original 85-probe rerun, adaptation diffs, JSON outcomes and source hashes; `validation/` holds required-check logs, JSON results, source hashes, isolated browser config, screenshots and cleanup receipt. The original reviewer inputs remain under `../cc5cir/evidence/adversarial/`. The builder inspected embedded dark Chromium and floating light Chromium/WebKit special-character screenshots; the required Grand reason wraps without clipping, with the selected project chip and Send visible. Browser cleanup confirms no owned preview processes or listeners remain.

## Scope and alternatives

Rejected a bidi renderer, decimal conversion table, whole-token confusable map, fuzzy/model routing and a new dependency. The absolute character gate replaces the two incomplete letter-only guards; the canonical registered-name conflict skeleton remains useful for ASCII references to non-ASCII names. No additional ledger, scheduler, authority or submission schema was introduced.

No native implementation changed, so Cargo checks are not applicable. Skipped live model turns, native/floating-window lifecycle acceptance, production profiles, publishing, deployment, other worktrees and branches, merge/rebase/push and dependency remediation. Previously accepted durable routes retain their existing recovery identities; this change governs new routing decisions. The known history-scan cost and failed-receipt fairness follow-ups are outside this round.
