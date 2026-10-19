import { evaluateLocalToolCall, exactIntegrationJson, type IntegrationContext, type IntegrationGrant, type LocalToolCall } from "./localToolPolicy";

export type LocalToolReceipt = {
  requestId: string; fingerprint: string; state: "reserved" | "completed" | "uncertain";
  at: number;
};

/** Ports must bind the existing serialized durable receipt/approval owner; no process-local approval store. */
export type LocalToolBrokerHost = {
  now(): number;
  current(call: LocalToolCall): { context: IntegrationContext; grant: IntegrationGrant };
  /** Atomically reserve requestId and consume exact one-use UI approval if required.
   * Replayed/conflicting/reserved/uncertain IDs return false, also after restart.
   * validate must run immediately before the durable commit. Save failure throws. */
  reserve(receipt: LocalToolReceipt, approval: Event | undefined, validate: () => void): Promise<boolean>;
  record(receipt: LocalToolReceipt): Promise<void>;
  /** Recheck authority/actual execution identity at the guarded native boundary. */
  execute(call: LocalToolCall, validate: () => void): Promise<unknown>;
};

/** A native click (including keyboard activation) on this exact request's execution button. */
export function isIntegrationUserEvent(event: Event | undefined, requestId: string): boolean {
  if (!event || !event.isTrusted || event.type !== "click" || typeof Element === "undefined") return false;
  const button = event.composedPath().find(target => target instanceof Element && target.matches("button[data-integration-execute]"));
  return button instanceof HTMLButtonElement && !button.disabled && button.isConnected &&
    button.dataset.integrationExecute === requestId && button.closest("[data-integration-ui]") !== null;
}

/** Returns results only after the final receipt is durable and authority remains current. */
export async function executeLocalTool(call: LocalToolCall, host: LocalToolBrokerHost, approval?: Event): Promise<unknown> {
  const captured = structuredClone(call);
  if (captured.tool === "project.skill.install" || captured.tool === "project.skill.archive")
    throw Error("Use the inspected skill's Install or Remove button yourself.");
  const initial = structuredClone(host.current(captured));
  const policy = evaluateLocalToolCall(captured, initial.context, initial.grant, host.now());
  if (policy.action === "deny") throw Error(policy.reason);
  if (policy.action === "ask" && !isIntegrationUserEvent(approval, captured.requestId))
    throw Error("This operation needs your direct explicit approval");
  const validate = () => {
    const live = host.current(captured);
    const next = evaluateLocalToolCall(captured, live.context, live.grant, host.now());
    if (next.action === "deny") throw Error(next.reason);
    if (next.action !== policy.action || next.fingerprint !== policy.fingerprint ||
        exactIntegrationJson(live.grant) !== exactIntegrationJson(initial.grant)) throw Error("Integration approval changed");
  };
  const receipt: LocalToolReceipt = { requestId: captured.requestId, fingerprint: policy.fingerprint, state: "reserved", at: host.now() };
  validate();
  if (!await host.reserve(receipt, policy.action === "ask" ? approval : undefined, validate))
    throw Error("Integration request already reserved; inspect its receipt before requesting a new operation");
  try {
    validate();
    const result = await host.execute(captured, validate);
    validate();
    await host.record({ ...receipt, state: "completed", at: host.now() });
    validate();
    return result;
  } catch (error) {
    // No retry: execution or final persistence may already have happened.
    await host.record({ ...receipt, state: "uncertain", at: host.now() });
    throw error;
  }
}
