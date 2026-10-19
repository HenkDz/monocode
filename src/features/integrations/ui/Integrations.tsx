import { useId, useRef, useState } from "react";
import { SecondaryButton } from "../../../shared/ui/SecondaryButton";
import { BROKER_SCOPE_NOTICE, LOCAL_RESULT_NOTICE, TOKEN_CUSTODY_NOTICE } from "../model/integrationCapabilities";
import { IntegrationRequestCard, type IntegrationRequestAction, type IntegrationRequestView } from "./IntegrationRequestCard";
import "./integrations.css";

export type ConnectedIntegration = {
  id: string; name: string; provider: "gh CLI" | "local MCP" | "skill";
  scope: string; monos: string[]; deadline?: number; callCount?: number; lastUsedAt?: number;
  available: boolean; unavailableReason?: string;
  skillDelivery?: "discovered" | "scoped-path" | "unverified";
  /** Prepared by the host after fresh installed-package inspection and exact operation binding. */
  removeRequestId?: string;
};
type Props = {
  connected: readonly ConnectedIntegration[];
  requests: readonly IntegrationRequestView[];
  loading?: boolean; error?: string;
  onRequest: IntegrationRequestAction;
  onRevoke(event: Event, item: ConnectedIntegration): Promise<void>;
};

function IntegrationRow({ item, onRevoke }: { item: ConnectedIntegration; onRevoke: Props["onRevoke"] }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const running = useRef(false);
  const removalReady = item.provider !== "skill" || !!item.removeRequestId && /^[A-Za-z0-9_-]{1,128}$/.test(item.removeRequestId);
  async function revoke(event: Event) {
    if (running.current || !item.available || !removalReady) return;
    running.current = true; setBusy(true); setError("");
    try { await onRevoke(event, item); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not revoke this access."); }
    finally { running.current = false; setBusy(false); }
  }
  return <li className="integration-row" data-integration-ui>
    <span className="integration-logo" aria-hidden="true">{item.provider === "gh CLI" ? "GH" : item.provider === "skill" ? "SK" : "MC"}</span>
    <div className="integration-row-copy"><strong>{item.name}</strong> <span className="integration-provider">{item.provider}</span>
      <p>{item.scope}{item.monos.length ? ` · used by ${item.monos.join(", ")}` : " · no Monos assigned"}
        {item.deadline !== undefined ? ` · until ${new Date(item.deadline).toLocaleString()}` : ""}</p>
      {!item.available && <p>{item.unavailableReason ?? "Unavailable: access could not be verified."}</p>}
      {item.provider === "gh CLI" && <p>Existing local CLI access · account not pinned. Agents' own terminals may use gh directly.</p>}
      {item.provider === "skill" && <p>{item.skillDelivery === "discovered" ? "Available in the requesting Mono's skill selection" : item.skillDelivery === "scoped-path"
        ? "Delivered as a scoped readable skill path" : "Installed · delivery unverified"}</p>}
      {item.provider === "skill" && !removalReady && <p>Review the current installed files before removing this skill.</p>}
      {error && <p className="integration-error" role="alert">{error}</p>}</div>
    <div className="integration-row-actions"><span className="integration-note">{item.callCount === undefined ? "Call count unavailable" : `${item.callCount.toLocaleString()} calls`}
      {item.lastUsedAt !== undefined ? ` · last used ${new Date(item.lastUsedAt).toLocaleString()}` : ""}</span>
      {item.provider !== "gh CLI" && <SecondaryButton disabled={busy || !item.available || !removalReady}
        data-integration-execute={item.provider === "skill" ? item.removeRequestId : undefined}
        onClick={event => void revoke(event.nativeEvent)}>{busy ? "Saving…" : item.provider === "skill" ? "Remove" : "Revoke"}</SecondaryButton>}</div>
  </li>;
}

/** Controlled projection of existing authority/receipts; mounting never discovers profiles or starts processes. */
export function Integrations({ connected, requests, loading = false, error, onRequest, onRevoke }: Props) {
  const title = useId();
  return <section className="integrations-page" aria-labelledby={title} aria-busy={loading}>
    <header><h2 id={title}>Integrations</h2><p>Agents request access · you connect · scoped to your project and goal</p></header>
    <div className="integrations-body">
      {loading && <p role="status">Loading approved local access…</p>}
      {error && <p className="integration-error" role="alert">{error}</p>}
      <h3 className="integration-section-label">Connected</h3>
      {connected.length ? <ul className="integration-list">{connected.map(item => <IntegrationRow key={item.id} item={item} onRevoke={onRevoke} />)}</ul>
        : !loading && !error && <p className="integration-note">No approved local integrations for this project yet.</p>}
      <h3 className="integration-section-label">Suggested by your team</h3>
      {requests.map(item => <IntegrationRequestCard key={item.id} item={item} onAction={onRequest} />)}
      {!requests.length && !loading && !error && <p className="integration-note">Your Manager will request tools when the goal needs them.</p>}
      <h3 className="integration-section-label">Rules</h3>
      <dl className="integration-rules"><div><dt>Approved exact tools and targets</dt><dd>Scoped project reads</dd></div>
        <div><dt>Always ask me</dt><dd>Merge · spend · delete · message people · system settings</dd></div>
        <div><dt>Install & connect</dt><dd>Your explicit action</dd></div>
        <div><dt>Provider</dt><dd>Existing CLI & local MCP</dd></div></dl>
      <p className="integration-note">{BROKER_SCOPE_NOTICE}</p><p className="integration-note">{LOCAL_RESULT_NOTICE}</p>
      <p className="integration-note">{TOKEN_CUSTODY_NOTICE}</p>
      <p className="integration-note">Remove archives a project skill. Revoke stops future broker calls; it does not sign out an existing CLI account.</p>
    </div>
  </section>;
}
