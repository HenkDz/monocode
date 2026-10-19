# Candidate c993d69 — prototype selector only

Frozen candidate `c993d6912c5902e7f2692153371d06f7417a80cf`, tree `ac6f35a7de51ba422b1cb61ace9ee69dcc0556e1`, clean checkout. This supersedes `ad526f9` for exact review and final gates; retain `REVIEW-REQUEST-ad526f9.md` for the complete scope, boundaries, contract targets and earlier evidence.

Only delta: `tests/browser/ccvision-v2.spec.ts` locates the approved prototype's Decisions destination by its accessible link name instead of exact plain text (the prototype anchor contains icon/count children). The prototype comparison timed out at that selector in `wired-browser-20261019T170735Z`; all four actual product scenarios passed. No assertion, deadline, skip, product source, fixture adapter or production guard changed. The raw log and entire failed browser artifact directory are preserved in `browser-artifacts-ad526f9-failed` before rerun.

`MANIFEST-c993d69.json` records all changed files against accepted V1. Authority/runtime source from ad526f9 is byte-identical in this pin; final exact-pin gates remain pending. No full suite has been run on either frozen wired pin yet. Root owns review, separate release and integration.
