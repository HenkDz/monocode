# Public V2 → V3 interface (source-only; root integrates)

Base is accepted `4b32e8b1`; independent source exists only in `ccvision-v2-decisions-runtime` until root accepts it. V3 should consume this contract, not copy unmerged files or touch held App/shell files. Imports flow V3 → V2; V2 imports no TeamMap/OrbitMap code.

## Existing public model types

`src/features/monos/model/monoDecisions.ts`: `MonoDecision`, `DecisionCommand`, `ProjectAutonomy = "high-impact-only" | "medium-and-up" | "everything"`, `bossMayDecide(decision, autonomy)`. Existing `MonoManagerGoals` remains the sole store; subscribe with its `subscribe`/`snapshot`, hydrate Managers through the existing owner lifecycle, use `autonomy(managerId, projectId)` only after ready. New `decisionHistoryState(managerId): "loading" | "ready"` and `decisionQuarantine(managerId): DecisionQuarantine[]` distinguish loaded data from loading and retain immutable read-only quarantine.

## Selector exports

`src/features/commandCenter/model/decisionView.ts`:

```ts
type OwnedDecision = { managerId: string; decision: MonoDecision };
type DecisionView = {
  pending: OwnedDecision[]; // Current, unresolved, user-level only; oldest first.
  log: OwnedDecision[]; // Resolved, newest first; stale records remain visibly recorded-only.
  teamPending: number;
  handledToday: number; // Local calendar day, retained readable CURRENT team resolutions only.
  pruned: number; // Older records omitted: counts describe retained history.
  loading: string[]; // Manager IDs; do not display missing data as a complete zero.
  quarantine: { managerId: string; entries: DecisionQuarantine[] }[];
};
selectDecisionView(ledger: MonoManagerGoals, roster: readonly Mono[], now: number, projectId?: string): DecisionView;
decisionActorName(roster: readonly Mono[], id: string): string;
```

Per-project counts: call selector with projectId; `pending.length` is the user badge. Whole-app rail: omit projectId. Values are derived, never a second store or bus. Quarantine never contributes active authority/counts. Only current actual decision IDs and versions may act.

## Component exports / callbacks

`src/features/commandCenter/ui/Decisions.tsx`:

```ts
type DecisionUiCommand = Exclude<DecisionCommand, { action: "ingest" }>;
type DecisionUiActions = {
  command(event: Event, managerId: string, requestId: string, command: DecisionUiCommand): Promise<unknown>;
  reraise(event: Event, managerId: string, requestId: string, oldDecisionId: string): Promise<void>;
  openProject(projectId: string): void;
};
Decisions({ view, roster, actions, unavailable?: boolean, presentation?: "page" | "rail" });
DecisionCard({ item: OwnedDecision, roster, actions, disabled?: boolean });
DecisionQuarantineNotice({ quarantine: DecisionView["quarantine"], actions, disabled?: boolean });
ProjectAutonomyControl({ managerId, projectId, value: ProjectAutonomy, actions, disabled?: boolean });
```

Components pass the direct native click event (including browser-generated keyboard clicks), preserve a request ID for uncertain retry, and retain expectedVersion from the displayed decision. They never run an operation. The production host verifies a trusted direct UI event whose target is inside `[data-decision-ui]`; the exported interactive components mark their own boundary with this attribute. Do not expose actor:user through chat/slash/CLI/habit/automation/deep links/restored queues. Delegation is only available for work decisions at the user level. Re-raise sends an ordinary queued message to the actual Manager; it does not reinstate corrupt authority or reuse an old decision ID.

Autonomy control works without any goal or conversation using live Manager/project roster membership. Disable it while loading/unavailable. Read-only evidence previews are bounded; raw quarantine never becomes authority. Production App host wiring is pending accepted V1 base/file handoff; callbacks alone are not product acceptance. All four Claude additions and final connected/browser/gates still apply.
