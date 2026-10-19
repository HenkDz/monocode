import { useId, useRef, useState } from "react";
import { SecondaryButton } from "../../../shared/ui/SecondaryButton";
import type { CapabilityRequest } from "../model/integrationCapabilities";
import { inspectLocalProjectSkill, type ProjectSkillInspection } from "../model/localToolAdapters";
import { executeInspectedProjectSkill, useProjectSkillBusy, type SkillOperationLog } from "../model/projectSkillActions";
import "./integrations.css";

export type IntegrationRequestView = {
  id: string; request: CapabilityRequest; name: string; requester: string;
  project: string; projectPath: string; mono: string; goal: string;
  provider: "gh CLI" | "local MCP" | "skill";
  available: boolean; unavailableReason?: string;
  status: "pending" | "completed" | "declined" | "uncertain";
};
/** Dismissing a suggestion only sends an ordinary answer; it never installs. */
export type IntegrationRequestAction = (event: Event, item: IntegrationRequestView, action: "later") => Promise<void>;

type Props = { item: IntegrationRequestView; onAction: IntegrationRequestAction; onLog?: SkillOperationLog; onChanged?: () => void };

export function IntegrationRequestCard(props: Props) {
  const { item } = props;
  if (item.provider !== "skill" || item.request.kind !== "install" || item.request.service !== "skill") return null;
  // A changed request remounts so an old inspection cannot approve new inputs.
  return <SkillInstallCard key={JSON.stringify([item.id, item.projectPath, item.name, item.request.source])} {...props} />;
}

function SkillInstallCard({ item, onAction, onLog, onChanged }: Props) {
  const title = useId(), detailsId = useId(), buttonId = useId();
  const [inspection, setInspection] = useState<ProjectSkillInspection>();
  const [showDetails, setShowDetails] = useState(false), [busy, setBusy] = useState(false);
  const [installed, setInstalled] = useState(false), [error, setError] = useState("");
  const running = useRef(false);
  const operationBusy = useProjectSkillBusy(inspection?.project ?? item.projectPath, item.name);
  const pending = item.status === "pending" && !installed;
  const disabled = busy || operationBusy || !item.available || !item.projectPath || !item.request.source;

  async function act(event: Event, action: "inspect" | "install" | "later") {
    if (running.current || !pending || action !== "later" && disabled) return;
    running.current = true; setBusy(true); setError("");
    try {
      if (action === "inspect") setInspection(await inspectLocalProjectSkill(item.projectPath, item.request.source!, item.name));
      else if (action === "install" && inspection) {
        await executeInspectedProjectSkill(event, buttonId, inspection, "install", onLog);
        setInstalled(true);
        try { onChanged?.(); } catch { /* Refresh cannot undo a successful installation. */ }
      } else if (action === "later") await onAction(event, item, "later");
    } catch (reason) {
      if (action === "install") setInspection(undefined);
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally { running.current = false; setBusy(false); }
  }

  return <article className="integration-request" data-integration-ui aria-labelledby={title}>
    <div className="integration-eyebrow"><span className="integration-tag">Skill</span><strong>{item.requester}</strong> suggested</div>
    <h3 id={title}>{item.name} for {item.project}</h3>
    <p className="integration-reason">{item.request.reason}</p>
    {inspection && <><p><strong>{inspection.declaredName}</strong> · {inspection.totalBytes.toLocaleString()} bytes</p>
      <p>{inspection.description}</p>
      <ul>{inspection.files.map(file => <li key={file.path}><code>{file.path}</code> · {file.bytes.toLocaleString()} bytes</li>)}</ul>
      <p className="integration-note">Files are copied as inspected. Nothing runs during install.</p></>}
    {!item.available && <p className="integration-note">{item.unavailableReason ?? "Installation is unavailable for this project."}</p>}
    {installed && <p role="status">Installed in {item.project}</p>}
    {item.status === "declined" && <p role="status">Not now</p>}
    <div className="integration-actions">
      {pending && <>{!inspection && <SecondaryButton disabled={disabled} onClick={event => void act(event.nativeEvent, "inspect")}>Inspect files</SecondaryButton>}
        <button type="button" className="integration-primary" disabled={disabled || !inspection}
          data-integration-execute={buttonId} onClick={event => void act(event.nativeEvent, "install")}>{busy ? "Working…" : "Install"}</button>
        <SecondaryButton disabled={busy || operationBusy} onClick={event => void act(event.nativeEvent, "later")}>Not now</SecondaryButton></>}
      <SecondaryButton aria-expanded={showDetails} aria-controls={detailsId} onClick={() => setShowDetails(value => !value)}>Details</SecondaryButton>
    </div>
    {showDetails && <div id={detailsId} className="integration-tools"><p>Mono: {item.mono} · Goal: {item.goal}</p>
      <p>Source: <code>{inspection?.source ?? item.request.source}</code></p>
      {inspection && <p>Fingerprint: <code>{inspection.fingerprint}</code></p>}
      <p>Installing adds project files. Availability depends on the requesting Mono's skill discovery and selection.</p></div>}
    {error && <p className="integration-error" role="alert">{error}</p>}
  </article>;
}
