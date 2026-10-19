# Concrete recipient action protocol / Stop delta for existing Claude

Actual App ingress is now wired. New decision records carry `eventProtocol:2`;
absent keeps exact legacy delivery JSON/signatures. New delivery text exposes
decisionId, expectedVersion, question, truthful impact/operation, exact retained
options/recommendation/selected option and a context preview capped at400 characters
with contextTruncated. This makes Manager/Boss resolution actionable through the
same team.message action protocol. Original full context stays in the ledger/UI;
original identity stays in the ledger and existing CC5D event fields, never text
authority. The existing4000-character delivery guard still rejects oversized
escaped payloads; no size/capacity guard is increased. No legacy byte migration.

Prompt guidance now teaches exact resolve/escalate/raise-impact/remind fields,
retained ID/version and same envelope requestId/body on uncertain retry, after
actual production route installation. Existing1250 guidance/9500-12500 prompt
budgets remain unchanged and are under affected regression validation.

App's Stop callback retires matching original request/requester decision authority
in the same existing serialized ledger and clears its outbox while preserving
evidence. Retired decisions cannot regain authority from a later same-engine run
or restart, and stale pending entries are visible in the decision log. Stop also
keeps session queueStatus paused even when the queue was empty, so later intake
does not silently restart that stopped recipient. Refresh with preserveQueue keeps
its original policy. Repeated App setup guard is applied to37 awaited setup calls
only when decision delivery is present, alongside existing publication validators.

App hydration reads actual ledgers/saved original blocks/sessions; it does not
start or rehydrate orchestration engines itself. The existing owner lifecycle
retains engine startup/recovery ownership. Tests execute production App host,
team ingress, digest acceptance and Stop seams against synthetic storage; final
browser/consumer/reload/frozen-source reviews remain pending.
