# R5 Live Acceptance Checklist

## Scope

- Documentation-only live acceptance in the isolated task checkout.
- Only `docs/r5-live-acceptance-checklist.md` changes.

## Checks

- Read `README.md` and `package.json` before editing.
- Record one live worker memory fact and run the 45-second delay before editing.
- Verify all four required headings with Node assertions and run `git diff --check`.
- No application tests were run.

## Review

R5_REVIEWED

- Independent review is required for the first draft.
- Wait for Manager follow-up before applying the requested correction to this same document.
- Require a new independent review of the latest implementing dispatch after correction.

## Merge

- The PR must explicitly target `nour`, based on `283e61ad28314d06302cae3fabfa359c3c43a9e1`.
- Manager owns authorized commit, push, and one PR after final independent approval.
- Merge is human-only; this worker does not publish, merge, or deploy.

R5_ZERO_PROMPT_CHAIN requires a new independent review of the latest implementing dispatch before Manager publication.
