import { useState } from "react";
import { loginHarness, supportsHarnessLogin } from "../../../integrations/harness/core/auth";
import { copyText } from "../../../platform/tauri/clipboard";
import { HARNESS_TITLE, type HarnessId } from "../model/session";
import { HarnessIcon } from "./HarnessIcon";

export function ProviderAuthNotice({ harness, accountId, diagnostics, disabled = false }: {
  harness: HarnessId;
  accountId?: string;
  diagnostics: string;
  disabled?: boolean;
}) {
  const [state, setState] = useState<"idle" | "running" | "complete" | "error">("idle");
  const [loginError, setLoginError] = useState("");
  const [copyState, setCopyState] = useState("");
  const title = HARNESS_TITLE[harness];
  const supported = supportsHarnessLogin(harness);
  return (
    <section id="provider-sign-in" data-provider-auth={harness} aria-label={`Sign in to ${title}`}
      className="mx-4 my-2 rounded-xl border border-content/12 bg-content/4 p-3 font-sans text-sm">
      <div className="flex items-start gap-3">
        <HarnessIcon harness={harness} className="mt-0.5 size-5 shrink-0 text-content/75" />
        <div role="status" className="min-w-0">
          <h2 className="font-medium text-content">{state === "complete" ? `Signed in to ${title}` : `Sign in to ${title}`}</h2>
          <p className="mt-1 text-xs text-content/75">
            {state === "complete" ? "Sign-in finished. Your request is still stopped; retry it when you are ready."
              : state === "error" ? "Sign-in could not finish. Try again or copy diagnostics."
              : disabled ? "Wait for the current request to stop before signing in."
              : supported ? "Your request stopped because this account needs to sign in."
              : "Sign in using this conversation's provider controls, then retry when you are ready."}
          </p>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {supported && <button type="button" disabled={disabled || state === "running" || state === "complete"}
          className="rounded-lg bg-content px-3 py-1.5 text-xs font-medium text-background-base hover:bg-content/85 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-50"
          onClick={() => {
            setState("running"); setLoginError("");
            void loginHarness(harness, accountId).then(
              () => setState("complete"),
              (error: unknown) => { setLoginError(String(error)); setState("error"); },
            );
          }}>
          {state === "running" ? "Waiting for browser…" : state === "complete" ? "Signed in" : `Sign in to ${title}`}
        </button>}
        <button type="button" className="rounded-md px-2 py-1 text-xs text-content/75 hover:bg-content/8 focus-visible:outline-2 focus-visible:outline-accent"
          onClick={() => { void copyText(loginError ? `${diagnostics}\n\n${loginError}` : diagnostics).then(
            () => setCopyState("Diagnostics copied"), () => setCopyState("Couldn't copy diagnostics"),
          ); }}>Copy diagnostics</button>
        {copyState && <span role="status" className="text-xs text-content/65">{copyState}</span>}
      </div>
    </section>
  );
}
