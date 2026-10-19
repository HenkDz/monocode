# Revised autonomy contract following Claude's required change

Supersedes only conflict-refusal behavior in CONTINUATION-CONTRACT-20261019.md.
That original document and its 295/295 test evidence remain preserved unchanged.

Reads/resolution select the strictest matching pathKey policy: everything,
medium-and-up, high-impact-only. Conflicts remain saved, visible as a quiet notice
in Decisions, and never block authorized resolution at the required level.

A fresh trusted user autonomy write is the newest explicit intent. It consolidates
all matching aliases into the one pathKey entry in the existing serialized ledger
save, preserving every unrelated policy/goal/receipt. When the replaced aliases
conflict, the same existing decision command receipt's result records
`{type:"autonomy-change", projectId, actorId:"user", at, replaced:[{projectId,value}], value}`.
There is no new store or bus and no fabricated goal/decision record. Retrying the
same request returns the same retained result without a second audit entry;
nonconflicting writes retain their original string result and consolidate quietly.
Bounded read-only receipt previews appear in the Decisions log, with who/time and
old-to-new values; they never supply work authority or operation permissions.

Consumer preparation now accepts a live retained-decision accessor. It validates
before and after awaited event hashing and returns the same synchronous guard for
every later setup await/publication boundary. Final actual App integration must
bind this guard alongside existing CC-GOAL/Stop/generation/binding checks. Source
adapters/focused tests alone remain partial, not final product acceptance.
