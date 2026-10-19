# Continuation harness failures (preserved)

- Initial source-search invocation through `rtk rg` containing a pipe regex was
  interpreted by the Windows wrapper as commands (`Decision is not recognized`).
  Reissued using `rtk proxy rg` with separate -e terms; no source changed.
- `rtk git rev-parse 'HEAD^{tree}'` lost its caret through the wrapper and failed
  as ambiguous `HEAD{tree}` after the successful 58f09900 commit. Reissued as
  `rtk git show -s --format=%T HEAD`, yielding 75388f8d8db63ecf05343179ea08019a7c85436e.
- Initial wired-gate preflight failed before RAM sampling or starting tsc because
  `Get-FileHash` is unavailable in this PowerShell environment. Reused the prior
  gate's System.Security.Cryptography.SHA256 implementation and retried. No test
  assertion, deadline, guard, skip, global environment or profile was changed.
- Several scoped reads used nonexistent guessed paths (COMMON under ccvision,
  managerWakeQueue.ts, features/workspace/WorkspaceContext, bootWorkspace.ts,
  monos/data/monoGoalHistory.ts); subsequent scoped searches located the actual
  source. These reads changed no state and do not represent validation results.
