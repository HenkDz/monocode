import { useState } from "react";
import { continueManagerRequest, type ManagerRequestRecovery } from "../model/managerAuthorizedWork";

export function ManagerRequestNotice({ request }: { request: ManagerRequestRecovery }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  return <section className="my-2 rounded-xl border border-content/15 p-3 font-sans text-sm" aria-label="Request confirmation">
    <p>This request needs your one-click confirmation.</p>
    <button type="button" className="mt-2 rounded bg-content/8 px-3 py-1.5 text-xs focus-visible:outline-accent"
      disabled={pending || request.state !== "pending"} onClick={() => {
        setPending(true); setError(undefined);
        void continueManagerRequest(request).catch(error => setError(String(error))).finally(() => setPending(false));
      }}>{request.state === "continued" ? "Request continued" : request.state === "cancelled" ? "Request cancelled" : "Continue this request"}</button>
    {error && <p role="alert" className="mt-2 text-xs">{error}</p>}
  </section>;
}
