import { isHarnessAuthError } from "../../../integrations/harness/core/authSupport";

export function transcriptError(error: string) {
  if (
    /private mono storage|storage.*(?:launch|mismatch|repair|blocked)|codex.*storage|storage.*codex/i.test(
      error,
    )
  )
    return {
      family: "storage",
      title: "Storage launch mismatch",
      cause: "This conversation's storage does not match the provider launch.",
      action: "Open storage recovery in the conversation, then retry.",
    };
  if (/sandbox|runtime_access_denied|\bEPERM\b|readiness/i.test(error))
    return {
      family: "sandbox",
      title: "Workspace access unavailable",
      cause: "The provider could not prepare access to this workspace.",
      action: "Check workspace access and sandbox setup, then retry.",
    };
  if (
    /usage.?limit|rate.?limit|quota|too many requests|\b429\b|limit.*reached/i.test(
      error,
    )
  )
    return {
      family: "usage",
      title: "Usage limit reached",
      cause: "The provider is temporarily limiting requests.",
      action: "Wait for the limit to reset or choose an available account.",
    };
  if (
    isHarnessAuthError(error) ||
    /unauthorized|unauthenticated|authentication|not logged in|sign.?in|invalid.*(?:token|api.?key)|\b401\b|login required/i.test(
      error,
    )
  )
    return {
      family: "auth",
      title: "Provider sign-in required",
      cause: "The provider could not authenticate this account.",
      action: "Sign in from the conversation's provider controls, then retry.",
    };
  if (
    /\bcli\b|executable|command not found|not recognized|\bENOENT\b|spawn.*failed/i.test(
      error,
    )
  )
    return {
      family: "cli",
      title: "Command could not start",
      cause: "The required command could not be found or launched.",
      action: "Check the configured command and installation, then retry.",
    };
  if (
    /transport|connection|disconnected|socket|\bECONN\w*\b|timed? ?out|network|broken pipe/i.test(
      error,
    )
  )
    return {
      family: "transport",
      title: "Provider connection interrupted",
      cause: "The connection ended before the request could finish.",
      action: "Check the connection and current request state before retrying.",
    };
  return {
    family: "other",
    title: "Request could not finish",
    cause: "The request stopped before it completed.",
    action: "Open details to check the cause and current request state.",
  };
}
