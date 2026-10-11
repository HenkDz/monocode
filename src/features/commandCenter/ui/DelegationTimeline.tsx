import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ComponentProps } from "react";
import { listMonos, monosSnapshot, subscribeMonos } from "../../monos/model/mono";
import { monoManagerGoals } from "../../monos/model/monoManagerGoals";
import { goalElapsedLabel, type GoalTarget } from "../model/goalView";
import { selectGoalTimeline, type GoalTimeline, type TimelineSpan } from "../model/timeline";
import { MissionControl } from "./MissionControl";
import "./delegationTimeline.css";

const duration = (span: TimelineSpan, now: number) => span.start != null && (span.end != null || span.ongoing)
  ? goalElapsedLabel((span.end ?? now) - span.start) : "Unknown";
const offset = (at: number | undefined, timeline: GoalTimeline) => at == null ? "Unknown" : goalElapsedLabel(at - timeline.start);

function useTimelineEscape(onBack: () => void, enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault(); event.stopPropagation(); onBack();
    };
    window.addEventListener("keydown", escape, true);
    return () => window.removeEventListener("keydown", escape, true);
  }, [onBack, enabled]);
}

export function DelegationTimeline({ timeline, onBack, onOpenTarget }: {
  timeline: GoalTimeline; onBack: () => void; onOpenTarget: (target: GoalTarget) => void | Promise<void>;
}) {
  const [error, setError] = useState<string>();
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, [timeline.goalId]);
  useTimelineEscape(onBack);
  const open = (target: GoalTarget) => {
    setError(undefined);
    void Promise.resolve().then(() => onOpenTarget(target)).catch(error => setError(error instanceof Error ? error.message : String(error)));
  };
  const width = Math.max(1, timeline.end - timeline.start);
  return <section className="delegation-timeline" aria-labelledby="delegation-timeline-title">
    <header className="dt-header"><div><p className="mc-eyebrow">Command center / Delegation timeline</p>
      <h1 id="delegation-timeline-title" ref={heading} tabIndex={-1}>{timeline.title}</h1>
      <p>{timeline.live ? "Window to current snapshot" : "Recorded window · goal completion time unknown"} · {goalElapsedLabel(timeline.end - timeline.start)}</p></div>
      <button className="mc-button" onClick={onBack}>Back to Mission control</button></header>
    <div className="dt-scroll">
      {error && <p role="alert">Could not open conversation: {error}</p>}
      <div className="dt-section-heading"><h2>Where the time went</h2><a className="mc-link" href="#timeline-ledger">Read interval ledger ↓</a></div>
      <p className="dt-note">Parallel lanes overlap; durations are not additive. Exact model / tool phases are unavailable in CC4. Unknown boundaries stay unknown. Blank space has no recorded coverage.</p>
      <ul className="dt-key" aria-label="Timeline key">{["unknown", "queued", "waiting", "compaction", "blocked", "milestone"].map(kind =>
        <li key={kind}><span data-kind={kind} aria-hidden="true" />{kind === "blocked" ? "Blocked now · start unknown" : kind === "milestone" ? "Recorded milestone" : kind}</li>)}</ul>
      <div className="dt-chart-scroll" tabIndex={0} role="region" aria-label="Delegation timeline chart; scroll horizontally on narrow screens">
        <div className="dt-chart"><div className="dt-axis"><span>Since first receipt</span><div>{[0, 1, 2, 3, 4].map(tick => <span key={tick}>{goalElapsedLabel(width * tick / 4)}</span>)}</div></div>
          {timeline.lanes.map(lane => <div className="dt-lane" key={lane.id}>
            <div className="dt-lane-name"><strong>{lane.name}</strong><span>{lane.role}{lane.review ? " · review" : ""}{lane.state ? ` · ${lane.state.replace(/_/g, " ")}` : ""}</span>
              {lane.assignment && <span>{lane.assignment}</span>}{lane.attempt && <code>{lane.attempt}</code>}
              {lane.review && <span className="dt-review">Reviews {lane.review.taskId} / {lane.review.dispatchId}{!lane.review.available && " · reference unavailable"}</span>}
              {lane.target && <button className="mc-link" onClick={() => open(lane.target!)} aria-label={`Open ${lane.name}${lane.attempt ? ` attempt ${lane.attempt}` : " conversation"}`}>Open conversation →</button>}</div>
            <div className="dt-tracks">{lane.spans.map(span => {
              const anchor = span.start ?? span.end;
              const left = anchor == null ? 0 : Math.min(100, Math.max(0, (anchor - timeline.start) / width * 100));
              const end = span.end ?? (span.ongoing ? timeline.end : undefined);
              const interval = span.start != null && end != null && end > span.start;
              const spanWidth = interval ? (end! - span.start!) / width * 100 : 0;
              const externalLabel = anchor != null && (!interval || spanWidth < 12);
              const title = `${span.label}: ${offset(span.start, timeline)} – ${span.ongoing ? "snapshot (ongoing)" : offset(span.end, timeline)} · ${duration(span, timeline.end)}. ${span.detail}`;
              return <div className="dt-track" key={span.id}><a href={`#ledger-${encodeURIComponent(lane.id + ":" + span.id)}`} className={`dt-span ${interval ? spanWidth < 12 ? "dt-narrow" : "" : "dt-point"} ${anchor == null ? "dt-untimed" : ""}`}
                data-kind={span.kind} aria-label={`${lane.name} · ${title}`} title={title}
                style={{ left: `${left}%`, width: interval ? `${spanWidth}%` : undefined }}>
                <span style={externalLabel ? left >= 70 ? { right: "calc(100% + 5px)", left: "auto" } : { left: "calc(100% + 5px)" } : undefined}>{span.label}{span.end == null && !span.ongoing && span.kind !== "milestone" ? " · timing unknown" : ""}</span></a></div>;
            })}</div>
          </div>)}
        </div>
      </div>
      <section id="timeline-ledger" className="dt-ledger" aria-labelledby="timeline-ledger-title">
        <h2 id="timeline-ledger-title">Interval ledger</h2>
        <p className="dt-note">Every chart span and milestone, in text. Unknown means no recorded boundary; ongoing ends at this snapshot.</p>
        <div className="dt-table-scroll" role="region" aria-label="Accessible interval ledger" tabIndex={0}><table>
          <caption>Goal {timeline.goalId} · receipts relative to {new Date(timeline.start).toISOString()} · snapshot {new Date(timeline.end).toISOString()}</caption>
          <thead><tr>{["Actor / attempt", "Interval or event", "Start", "End", "Duration", "Evidence"].map(label => <th scope="col" key={label}>{label}</th>)}</tr></thead>
          <tbody>{timeline.lanes.flatMap(lane => lane.spans.map(span => <tr key={lane.id + span.id} id={`ledger-${encodeURIComponent(lane.id + ":" + span.id)}`} tabIndex={-1}>
            <th scope="row">{lane.name}<small>{lane.attempt ?? lane.role}</small>{lane.assignment && <small>{lane.assignment}</small>}</th>
            <td>{span.label}{lane.review && <small>Reviews {lane.review.taskId} / {lane.review.dispatchId}{!lane.review.available && " · reference unavailable"}</small>}</td>
            <td>{offset(span.start, timeline)}</td><td>{span.kind === "milestone" || span.kind === "blocked" ? "Point observation" : span.ongoing ? `${offset(timeline.end, timeline)} · ongoing` : offset(span.end, timeline)}</td>
            <td>{span.kind === "milestone" ? "—" : duration(span, timeline.end)}</td><td>{span.detail}</td>
          </tr>))}</tbody>
        </table></div>
      </section>
    </div>
  </section>;
}

// CC7E route hook: retain Mission control's mounted filters/history/scroll and shell lifecycle.
export function DelegationTimelineRoute(props: ComponentProps<typeof MissionControl>) {
  const [goalId, setGoalId] = useState<string>();
  const invoker = useRef<HTMLAnchorElement | null>(null);
  const missingBack = useRef<HTMLButtonElement>(null);
  const rosterVersion = useSyncExternalStore(subscribeMonos, monosSnapshot);
  const goalsVersion = useSyncExternalStore(monoManagerGoals.subscribe, monoManagerGoals.snapshot);
  const roster = useMemo(() => listMonos(), [rosterVersion]);
  const goals = useMemo(() => monoManagerGoals.goals(), [goalsVersion]);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!props.open || !goalId) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [props.open, goalId]);
  const timeline = useMemo(() => goalId ? selectGoalTimeline({ goalId, goals, roster, runs: props.runs, sessions: props.sessions, now }) : undefined,
    [goalId, goals, roster, props.runs, props.sessions, now]);
  useEffect(() => { if (!goalId && props.open) invoker.current?.focus(); }, [goalId, props.open]);
  const back = () => setGoalId(undefined);
  useTimelineEscape(back, props.open && !!goalId && !timeline);
  useEffect(() => { if (props.open && goalId && !timeline) missingBack.current?.focus(); }, [props.open, goalId, timeline]);
  return <div className="dt-route" hidden={!props.open} inert={!props.open || undefined} onClick={event => {
    const link = (event.target as HTMLElement).closest<HTMLAnchorElement>("a[data-goal-timeline]");
    if (!link) return;
    event.preventDefault(); invoker.current = link; setGoalId(link.dataset.goalTimeline);
  }}>
    <MissionControl {...props} open={props.open && !goalId} />
    {props.open && goalId && (timeline ? <DelegationTimeline timeline={timeline} onBack={back} onOpenTarget={props.onOpenTarget} />
      : <section className="dt-missing"><p role="status">This goal is no longer available.</p><button ref={missingBack} className="mc-button" onClick={back}>Back to Mission control</button></section>)}
  </div>;
}
