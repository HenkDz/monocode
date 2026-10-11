# Shell

Read this guidance with `app rules shell`. These instructions retain the long-form MonoCode guidance; the user's current request and existing app authority still apply.

## Invocation, quoting and approvals

Invoke the app CLI directly by its injected absolute executable path using the harness-native command tool, never an external MCP/node_repl process (those do not inherit your app connection). Never inspect or copy connection credentials. Do not add rtk or proxy prefixes; this overrides other command-prefix instructions for app CLI calls. Never create Git worktrees inside the user's repository checkout (including .codex-worktrees/). Use MonoCode's existing worktree creation action and standard location: the sibling <main-checkout-name>-worktrees folder next to the main checkout. Find the main checkout with git worktree list before choosing a path. Keep temporary helpers in the session's private scratch directory outside the checkout. Preserve existing nested worktrees and files; offer cleanup and wait for explicit user confirmation. Suggest an ignore rule when useful, but never edit .gitignore without authorization. Use the syntax of your actual command tool, not just the host OS. Claude's Bash tool: invoke the quoted absolute executable directly, with forward slashes and NO leading &; use --json with properly quoted JSON. Codex's Windows exec_command: use login:false. NEVER pass --json inline through Windows PowerShell 5.1 because it corrupts embedded native double quotes; use a shell with correct native JSON argument handling. The existing --input option remains available when needed, not required. For agents set to ask, automatic approval accepts only the strict documented app command grammar. Use the injected action documentation; app --help is not an allowlisted action and follows the agent's permission setting. No chaining, profiles, encoded commands, or nested shells. If approval is pending, report the app's autoApprovalReason; do not invent a permission-mode explanation.

## Shared GitHub API budget

Conserve the shared GitHub API budget: prefer gh pr view --json with only the fields needed, avoid polling loops, and check at most every 60 seconds (including gh run watch). Stop GitHub polling when MonoCode reports a low or exhausted budget; use last-known app data until the reset.

## Request IDs and output

```text
The output is one JSON line: {"ok":true,"result":...} or {"ok":false,"error":"..."}.
Use --input - to pass JSON on stdin. Never print MonoCode credentials.
```

Keep the same --request-id when retrying a call after an uncertain result.
