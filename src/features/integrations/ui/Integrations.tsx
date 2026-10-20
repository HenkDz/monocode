import { useId, useRef, useState } from "react";
import { pathKey } from "../../../shared/lib/paths";
import { SecondaryButton } from "../../../shared/ui/SecondaryButton";
import { inspectLocalProjectSkill, type ProjectSkillInspection } from "../model/localToolAdapters";
import { executeInspectedProjectSkill, useProjectSkillBusy, type SkillOperationLog } from "../model/projectSkillActions";
import { IntegrationRequestCard, type IntegrationRequestAction, type IntegrationRequestView } from "./IntegrationRequestCard";
import "./integrations.css";

export type ConnectedIntegration = {
  id: string; name: string; provider: "gh CLI" | "local MCP" | "skill";
  scope: string; monos: string[]; available: boolean; unavailableReason?: string;
  projectPath?: string; skillPath?: string;
  /** Only set after exact requester discovery/selection proves this installed path is available. */
  skillDelivery?: "discovered" | "scoped-path" | "unverified";
};
type Props = {
  connected: readonly ConnectedIntegration[]; requests: readonly IntegrationRequestView[];
  loading?: boolean; error?: string; onRequest: IntegrationRequestAction;
  onLog?: SkillOperationLog; onChanged?: () => void;
};

function SkillRow({ item, onLog, onChanged }: { item: ConnectedIntegration; onLog?: SkillOperationLog; onChanged?: () => void }) {
  const buttonId = useId();
  const [inspection, setInspection] = useState<ProjectSkillInspection>();
  const [busy, setBusy] = useState(false), [removed, setRemoved] = useState(false), [error, setError] = useState("");
  const running = useRef(false);
  const operationBusy = useProjectSkillBusy(inspection?.project ?? item.projectPath ?? "", item.name);
  const source = `${item.projectPath?.replace(/[\\/]+$/, "")}/.agents/skills/${item.name}`;
  const removable = !!item.projectPath && !!item.skillPath && pathKey(item.skillPath) === pathKey(`${source}/SKILL.md`);
  async function remove(event: Event) {
    if (running.current || operationBusy || !removable || !item.projectPath) return;
    running.current = true; setBusy(true); setError("");
    try {
      if (!inspection) setInspection(await inspectLocalProjectSkill(item.projectPath, source, item.name));
      else {
        await executeInspectedProjectSkill(event, buttonId, inspection, "archive", onLog);
        setRemoved(true);
        try { onChanged?.(); } catch { /* Refresh cannot undo a successful archive. */ }
      }
    } catch (reason) { setInspection(undefined); setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { running.current = false; setBusy(false); }
  }
  return <li className="integration-row" data-integration-ui>
    <span className="integration-logo" aria-hidden="true">SK</span>
    <div className="integration-row-copy"><strong>{item.name}</strong><p>{removed ? `Removed from ${item.scope}` : `Installed in ${item.scope}`}</p>
      {!removed && item.skillDelivery === "discovered" && item.monos.length > 0 && <p>Available to {item.monos.join(", ")}</p>}
      {inspection && !removed && <><p>{inspection.declaredName} · {inspection.description} · {inspection.totalBytes.toLocaleString()} bytes</p>
        <ul>{inspection.files.map(file => <li key={file.path}>{file.path} · {file.bytes.toLocaleString()} bytes</li>)}</ul>
        <p>Remove archives these files.</p></>}
      {error && <p className="integration-error" role="alert">{error}</p>}</div>
    {!removed && removable && <div className="integration-row-actions"><SecondaryButton disabled={busy || operationBusy}
      data-integration-execute={inspection ? buttonId : undefined} onClick={event => void remove(event.nativeEvent)}>
      {busy ? "Working…" : inspection ? "Remove" : "Inspect to remove"}</SecondaryButton></div>}
  </li>;
}

/** The host supplies real project discoveries; mounting never probes profiles or starts processes. */
export function Integrations({ connected, requests, loading = false, error, onRequest, onLog, onChanged }: Props) {
  const title = useId();
  const installed = connected.filter(item => item.provider === "skill" || item.provider === "gh CLI" && item.available);
  const suggestions = requests.filter(item => item.provider === "skill" && item.request.kind === "install" && item.request.service === "skill");
  return <section className="integrations-page" aria-labelledby={title} aria-busy={loading}>
    <header><h2 id={title}>Integrations</h2><p>Skills and tools for this project</p></header>
    <div className="integrations-body">
      {loading && <p role="status">Loading integrations…</p>}
      {error && <p className="integration-error" role="alert">{error}</p>}
      {installed.length > 0 && <><h3 className="integration-section-label">Available in this project</h3><ul className="integration-list">{installed.map(item => item.provider === "skill"
        ? <SkillRow key={JSON.stringify([item.id, item.projectPath, item.skillPath, item.name])} item={item} onLog={onLog} onChanged={onChanged} />
        : <li className="integration-row" key={item.id}><span className="integration-logo" aria-hidden="true">GH</span>
          <div className="integration-row-copy"><strong>GitHub</strong><p>Uses your GitHub login on this PC</p></div></li>)}</ul></>}
      {!installed.length && !loading && !error && <div className="integration-empty"><h3>Your project’s skills live here</h3><p>When a Manager needs a skill, it'll ask you here. Installed skills show up in this list.</p></div>}
      {suggestions.length > 0 && <h3 className="integration-section-label">Suggested skills</h3>}
      {suggestions.map(item => <IntegrationRequestCard key={item.id} item={item} onAction={onRequest} onLog={onLog} onChanged={onChanged} />)}
    </div>
  </section>;
}
