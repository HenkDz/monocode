# Project Manager PR card acceptance test

## Scope

This is a documentation-only live acceptance test. It adds this single file
to demonstrate the native Project Manager PR card in the isolated polished
preview. No feature implementation is included, and nothing here claims
Project Manager is released.

## Validation

The manager independently reviews the one-file diff and runs document and
whitespace checks (for example `git diff --check`), then records the actual
results in the review summary. Any application test that is missing or
skipped is reported as such, never as passing.

## Handoff

Once an open, non-draft PR targets `nour` and control review accepts the
result, the native PR card is expected to show the PR link and review
summary. Only the human user merges the PR.
