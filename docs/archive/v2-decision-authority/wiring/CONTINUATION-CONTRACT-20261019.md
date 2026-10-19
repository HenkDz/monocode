# V2 continuation contract delta - independent preparation

Preserved base: clean `0a3f0f21eeeab0771cf8421dfdd08cbad701d092`, tree
`05fbe1626575cf99ba0a8242ffaa495626f879fe`. Historical checkpoint/reports/raw
failures are unchanged. Shared App/shell files remain HELD pending root's accepted V1.

- Autonomy reads and resolution use existing `pathKey` identity. A user write
  consolidates matching, nonconflicting legacy Windows spellings into that key.
  Conflicting saved aliases reject reads/resolution/writes visibly without a save;
  they are never overwritten, silently selected, or converted to a wider default.
  POSIX case remains significant. Roster membership/no-goal behavior is preserved.
- Team action text accepts only version 1 / type `decision-action` and exactly
  `action`, `decisionId` (1-256 chars), `expectedVersion` (nonnegative safe integer),
  plus `optionId` (1-64 chars) for resolve or `impact` (low/med/high) for raise-impact.
  Only resolve/escalate/raise-impact/remind are available to Monos. Actor, goal,
  request identity, user delegation/autonomy and extra fields are refused. Retry ID
  stays the existing authenticated team.message envelope request ID; retries retain
  the exact ID, payload, decision ID and expected version. No additional bus/store.
  Prompt publication waits for the actual accepted-V1 App route; current adapters
  remain partial source and are not advertised as functioning product wiring.
- Queue host requires storage read-back after its existing serialized update.
  The adapter verifies exact session/event ID, body, internal evidence reference
  and request ID before returning, so malformed/missing/failed read-back retains
  the original ledger outbox. No turn starts or steers in intake. Final App writer
  must still prove save-before-publication and all post-await consumer/Stop guards.
- Live sender turn generation and busy/owner/binding are checked separately from
  retained original dispatch.startedAt/goal.createdAt; neither is a replacement
  for the other. Stopping a sender during a save prevents subsequent publication.

Direct UI `isTrusted` is an in-app scripting boundary, not proof of OS-level human
presence or isolation from computer-use automation. Protected operation gates stay
authoritative. Existing Claude must review final actual wiring at its exact pin;
this early delta has no final acceptance claim.
