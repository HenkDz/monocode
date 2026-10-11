import { useState } from "react";
import { goalElapsedLabel, type GoalTarget } from "../model/goalView";
import type { GoalTimeline, TimelineSpan } from "../model/timeline";

export function GoalProgress({ timeline, onOpenTarget }: { timeline?: GoalTimeline; onOpenTarget: (target: GoalTarget) => void }) {
  const [tab, setTab] = useState("Phases");
  const [phase, setPhase] = useState("Working");
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<string>();
  const rows = timeline?.lanes.flatMap(lane => lane.spans.map(span => ({ lane, span, id: `${lane.id}:${span.id}` })))
    .sort((a, b) => (a.span.start ?? a.span.end ?? Infinity) - (b.span.start ?? b.span.end ?? Infinity)) ?? [];
  const pages = Math.max(1, Math.ceil(rows.length / 4));
  const currentPage = Math.min(page, pages - 1);
  const duration = (span: TimelineSpan) => span.start != null && (span.end != null || span.ongoing)
    ? goalElapsedLabel(Math.max(0, (span.end ?? timeline!.end) - span.start)) : "Unknown";
  const phaseSpans = (name: string) => rows.filter(({ span }) => name === "Waiting" ? ["waiting", "queued"].includes(span.kind) : name === "Compaction" && span.kind === "compaction");
  const phaseRows = phaseSpans(phase);
  const reviews = timeline?.lanes.filter(lane => lane.review) ?? [];
  const reviewNotStarted = reviews.length > 0 && reviews.every(lane =>
    lane.spans.some(span => span.kind === "queued" && span.ongoing) && !lane.spans.some(span => span.id.startsWith("turn:")));
  const phaseLabel = (name: string) => {
    if (name === "Review" && reviewNotStarted) return "Not started";
    const spans = phaseSpans(name);
    return spans.length === 1 ? duration(spans[0].span) : spans.length > 1 ? `${spans.length} spans` : "Unknown";
  };
  const details = rows.find(row => row.id === selected);
  return <section className="mc-progress" aria-label="Time & progress">
    <div className="mc-section-heading"><h3>Time & progress</h3><div className="mc-segmented" role="group" aria-label="Timeline view">{["Phases", "Ledger"].map(value =>
      <button type="button" key={value} aria-pressed={tab === value} onClick={() => { setTab(value); setSelected(undefined); }}>{value}</button>)}</div></div>
    {tab === "Phases" ? <>
      <div className="mc-phases" role="group" aria-label="Phase categories, not additive durations">{["Planning", "Working", "Review", "Waiting", "Compaction"].map((name, index) =>
        <button key={name} type="button" data-phase={index} aria-pressed={phase === name} onClick={() => { setPhase(name); setSelected(undefined); }}>
          <span className="mc-phase-line" /><span>{name}</span><small>{phaseLabel(name)}</small></button>)}</div>
      <p className="mc-phase-detail">{phase === "Review" && reviewNotStarted ? "Review: not started. Recorded review assignments are awaiting turn start."
        : ["Planning", "Working", "Review"].includes(phase)
        ? `${phase}: exact phase boundaries are unavailable. Recorded turns do not identify model or tool phases.`
        : phaseRows.length ? phaseRows.map(({ lane, span }) => `${lane.name} · ${span.label} · ${duration(span)}`).join("; ")
        : `${phase}: no recorded boundaries.`}</p>
      <div className="mc-key-events"><span>Key events</span>{rows.filter(row => row.span.kind === "milestone").slice(0, 2).map(row =>
        <button type="button" key={row.id} onClick={() => setSelected(row.id)}>{row.span.label}</button>)}</div>
    </> : <><div className="mc-ledger-scroll"><table className="mc-ledger"><caption>Recorded intervals · parallel lanes overlap</caption>
      <thead><tr><th scope="col">Time</th><th scope="col">Event / actor</th><th scope="col">Duration</th></tr></thead>
      <tbody>{rows.slice(currentPage * 4, currentPage * 4 + 4).map(row => <tr key={row.id}><td>{row.span.start == null ? "Unknown" : new Date(row.span.start).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</td>
        <th scope="row"><button type="button" aria-pressed={selected === row.id} onClick={() => setSelected(row.id)}>{row.span.label}<small>{row.lane.name}</small></button></th><td>{duration(row.span)}</td></tr>)}</tbody></table></div>
      {!rows.length && <p className="mc-phase-detail">No timeline evidence available.</p>}
      <div className="mc-paging"><button type="button" aria-label="Previous ledger page" disabled={!currentPage} onClick={() => { setPage(currentPage - 1); setSelected(undefined); }}>←</button>
        <span>{currentPage + 1} / {pages}</span><button type="button" aria-label="Next ledger page" disabled={currentPage + 1 >= pages} onClick={() => { setPage(currentPage + 1); setSelected(undefined); }}>→</button></div>
    </>}
    {details && <div className="mc-event-detail" role="status"><strong>{details.lane.name} · {details.span.label}</strong><p>{details.span.detail}</p>
      <p>{details.lane.attempt ? `Attempt ${details.lane.attempt} · ` : ""}{details.lane.review ? `Reviews ${details.lane.review.taskId} / ${details.lane.review.dispatchId} · ` : ""}
        {details.span.start == null ? "Start not recorded" : `Start ${new Date(details.span.start).toLocaleString()}`} · {details.span.end == null ? details.span.ongoing ? "Ongoing to snapshot" : "End not recorded" : `End ${new Date(details.span.end).toLocaleString()}`}</p>
      {details.lane.target && <button type="button" className="mc-link" onClick={() => onOpenTarget(details.lane.target!)}>Open recorded conversation →</button>}</div>}
  </section>;
}
