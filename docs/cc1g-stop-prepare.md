# CC1G: Stop during prompt preparation

All eleven harness adapters now recheck their existing cancellation or
lifecycle state immediately after `prepareText` resolves. Cancelled or retired
turns return before serialization, provider writes, acceptance callbacks or
new turn latches. The source change is ten guard lines; Pi and OMP share
`piFamily.ts`. Existing cancellation settlement, generation handling, metrics
and compaction events remain intact.

ACP adapters check cancellation and live-transport ownership. Codex, Claude,
Pi/OMP and OpenCode check cancellation and muted updates, which their Stop
paths set before teardown. The committed CC1FR reproductions hold preparation
and cancellation transport separately, wait for the cancelled turn to settle,
then assert no submitted prompt or acceptance. Every cancellation scenario
submits a valid subsequent turn on the same session ID. Direct session Stop,
throwing preparation and supported ACP image attachments are also covered.

The correction belongs at the provider submission boundary: waiting for
eventual transport shutdown or suppressing a late UI receipt cannot prevent
a physical prompt write. No new cancellation abstraction, UI generation or
provider protocol was needed. No shared App/orchestration edit was needed.

The prompt budget now explicitly distinguishes the assembled context region
from text after the real registry appends `monocode_cli_input`. With synthetic
Windows executable/private-input paths of 110/175 characters, the unchanged
suffix adds 650 characters. Grand Orch/Manager/member steady application text
is **1,521/1,513/1,507 characters**, including the suffix. With the 58-character
request, submitted text is **1,579/1,571/1,565**. The region budget remains
1,000; the separate registry application-text budget is 1,700. These measure
the fixture's submitted text, excluding provider protocol envelopes,
attachments, global skills/plugins and history. See `cc1-prompt-diet.md`.

The suffix wording was retained: executable precedence and private-input
scoping still apply every turn. Budgets are regression assertions, not runtime
truncation of arbitrary paths or user-authored content.

## Validation

Windows; Node 26.5.0, npm 11.17.0. Web commands use process-local
`NODE_OPTIONS=--no-experimental-webstorage`; real/soak provider tests are gated
off with `AGY_REAL=0` and `AGY_SOAK=0`.

| Check | Result |
| --- | --- |
| ACP reproduction before source fixes | 21 passed, 15 failed, 0 skipped; 36 tests |
| Protocol reproduction before source fixes | 6 passed, 9 failed, 0 skipped; 15 tests |
| Fixed ACP preparation regressions | 36 passed, 0 failed/skipped |
| Fixed protocol preparation regressions | 20 passed, 0 failed/skipped |
| ACP provider/client suite | 19 files passed, 2 skipped; 251 tests passed, 13 skipped, 0 failed |
| Region/registry budget, receipts and compaction checks | 4 files; 83 tests passed, 0 failed/skipped |
| Full `npx vitest run --maxWorkers=1` | 564 files passed, 2 skipped, 0 failed (566); 6,330 tests passed, 13 skipped, 0 failed (6,343); 654.30 s runner / 657.453 s wall |
| `npx tsc --noEmit` | Exit 0, no diagnostics; 137.969 s wall |
| `npm run build` | Exit 0; production build passed; 185.438 s wall |

The protocol fixture initially omitted OpenCode's resumed-session HTTP
response; it was corrected without changing product behavior. Earlier wider
protocol runs also retained an unchanged `opencodeContext.test.ts` timeout.
Those failures remain in the evidence rather than being discarded. That test
passed in isolation with its original timeout and in the full suite. No existing
test source, timeout or skip was changed to obtain the full-suite pass. The 13
existing skipped tests belong to Antigravity real/soak coverage. Existing
dependency advisories and build/mocked-native warnings remain in the logs.

## Evidence and limits

Program root: `C:/Users/nooro/AppData/Local/Temp/monocode-cc/`.

- Original review reproductions: `cc1fr/adapters/prepare-acp.test.ts`,
  `cancel-protocol.test.ts` and `REVIEW.md`.
- Current baseline/fixed/provider checks: `cc1g/acp/` and `cc1g/protocol/`.
- Actual region/registry measurements and focused checks: `cc1g/budget/`;
  rerunning tests also writes `target/cc1-verification/after.json` and
  `registry-steady.json` in this worktree.
- Final combined commands, logs, JSON results and receipts:
  `cc1g/validation/`; branch, commit and complete inventory: `cc1g/REPORT.md`.

Synthetic transports exercise real adapters and protocol clients; this is
local cancellation-order proof, not installed-app or live-provider acceptance.
Production race frequency, tokenizer costs and arbitrary path lengths were
not measured. The guard does not interrupt the preparation hook itself;
settlement still waits for preparation to resolve. No live model turn,
desktop preview, real-profile write, native change, dependency change,
other-worktree write, merge, rebase or push occurred.
Native tests were not run because this round changes no native code.
