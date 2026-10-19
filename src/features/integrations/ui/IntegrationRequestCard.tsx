import { useId, useRef, useState } from "react";
import { SecondaryButton } from "../../../shared/ui/SecondaryButton";
import { capabilityToolLabel, LOCAL_RESULT_NOTICE, type CapabilityRequest } from "../model/integrationCapabilities";
import type { ProjectSkillInspection } from "../model/localToolAdapters";
import "./integrations.css";

export type IntegrationRequestView = {
  id: string; request: CapabilityRequest; name: string; requester: string;
  project: string; mono: string; goal: string;
  provider: "gh CLI" | "local MCP" | "skill";
  available: boolean; unavailableReason?: string;
  status: "pending" | "completed" | "declined" | "uncertain";
  inspection?: ProjectSkillInspection;
  /** Exact inspected arguments; display data confers no execution authority. */
  arguments?: Record<string, unknown>;
};
/** Inspect returns native metadata only; it never authorizes install or sends file contents to a model. */
export type IntegrationRequestAction = (event: Event, item: IntegrationRequestView, action: "inspect" | "execute" | "later") => Promise<void>;

export function IntegrationRequestCard({ item, onAction }: { item: IntegrationRequestView; onAction: IntegrationRequestAction }) {
  const title = useId(), toolsId = useId();
  const [showTools, setShowTools] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const running = useRef(false);
  const install = item.request.kind === "install", merge = item.request.kind === "merge";
  const existingCli = item.provider === "gh CLI" && !merge;
  const verb = install ? "Install" : merge ? "Review merge" : existingCli ? "Review" : "Connect";
  const pending = item.status === "pending";
  const available = item.available && !existingCli && (!install || !!item.inspection);
  async function act(event: Event, action: "inspect" | "execute" | "later") {
    if (running.current || !pending || action === "execute" && !available) return;
    if (action === "inspect" && (!install || !item.available || !!item.inspection)) return;
    running.current = true; setBusy(true); setError("");
    try { await onAction(event, item, action); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save this action. Inspect the receipt before retrying."); }
    finally { running.current = false; setBusy(false); }
  }
  return <article className="integration-request" data-integration-ui aria-labelledby={title}>
    <div className="integration-eyebrow"><span className="integration-tag">{install ? "Install" : merge ? "Merge request" : "Access request"}</span>
      <strong>{item.requester}</strong> {install ? "wants to add a skill" : "needs access for this goal"}</div>
    <h3 id={title}>{verb} {item.name} for {item.project}{install && item.inspection ? ` (${item.inspection.totalBytes.toLocaleString()} bytes)` : ""}?</h3>
    <p className="integration-reason">{item.request.reason}</p>
    <div className="integration-scopes"><span>Project: {item.project}</span><span>Mono: {item.mono}</span><span>Goal: {item.goal}</span>
      {item.request.scopes.map(scope => <span key={scope}>{scope}</span>)}
      <span>Until {new Date(item.request.deadline).toLocaleString()} or goal ends</span></div>
    <p className="integration-note"><span className="integration-provider">{item.provider}</span> {LOCAL_RESULT_NOTICE}</p>
    {merge && <p className="integration-note">Merge still requires the existing exact-head review and your explicit confirmation.</p>}
    {install && item.inspection && <><p>Declared skill: <strong>{item.inspection.declaredName}</strong></p><p>{item.inspection.description}</p>
      <p className="integration-note">{item.inspection.files.length} inspected files · copied verbatim · nothing runs during install</p></>}
    {install && <p className="integration-note">Inspection refuses secret-named files; the package is copied only if every file is accepted.</p>}
    {!available && pending && <p className="integration-note">{item.unavailableReason ?? (existingCli
      ? "Existing local CLI access · account not pinned. Governed GitHub connection is unavailable."
      : install
      ? "Install not available yet: ask the Manager to proceed without it."
      : "Connection unavailable: an approved local adapter is required.")}</p>}
    {!pending && <p role="status" className="integration-note">{item.status === "completed" ? "Completed · recorded receipt" : item.status === "declined" ? "Not now · the team can plan without this access" : "Outcome uncertain · inspect the receipt before requesting another operation"}</p>}
    <div className="integration-actions">
      {pending && <>{install && !item.inspection && <SecondaryButton disabled={busy || !item.available}
        data-integration-inspect={item.id} onClick={event => void act(event.nativeEvent, "inspect")}>Inspect files</SecondaryButton>}
        <button type="button" className="integration-primary" disabled={busy || !available}
        data-integration-execute={item.id} onClick={event => void act(event.nativeEvent, "execute")}>{busy ? "Saving…" : verb}</button>
        <SecondaryButton disabled={busy} onClick={event => void act(event.nativeEvent, "later")}>Not now</SecondaryButton></>}
      <SecondaryButton aria-expanded={showTools} aria-controls={toolsId} onClick={() => setShowTools(value => !value)}>{showTools ? "Hide tools" : install ? "See files & tools" : "See tools"}</SecondaryButton>
    </div>
    {showTools && <div id={toolsId} className="integration-tools"><ul>{item.request.tools.map(tool => <li key={tool}>
      <code>{tool}</code> · {capabilityToolLabel(tool)}</li>)}</ul>
      {item.arguments && <pre>{JSON.stringify(item.arguments, null, 2)}</pre>}
      {item.inspection && <><p>Source: <code>{item.inspection.source}</code></p><p>Fingerprint: <code>{item.inspection.fingerprint}</code></p>
        <ul>{item.inspection.files.map(file => <li key={file.path}><code>{file.path}</code> · {file.bytes.toLocaleString()} bytes</li>)}</ul></>}
      <p className="integration-note">Only these exact approved tools and targets may run. No shell, proxy, code or unknown tools.</p></div>}
    {error && <p className="integration-error" role="alert">{error}</p>}
  </article>;
}
