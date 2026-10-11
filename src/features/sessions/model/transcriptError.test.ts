import { expect, it } from "vitest";
import { transcriptError } from "./transcriptError";

it.each([
  [
    "Private Mono storage is only supported for Codex app-server",
    "storage",
    "Storage launch mismatch",
  ],
  [
    "Codex storage launch blocked: repair required",
    "storage",
    "Storage launch mismatch",
  ],
  [
    "runtime_access_denied: sandbox readiness failed",
    "sandbox",
    "Workspace access unavailable",
  ],
  ["EPERM opening workspace", "sandbox", "Workspace access unavailable"],
  ["You've reached your usage limit", "usage", "Usage limit reached"],
  ["HTTP 429 too many requests", "usage", "Usage limit reached"],
  [
    "Provider authentication failed: invalid API key",
    "auth",
    "Provider sign-in required",
  ],
  ["HTTP 401 Unauthorized", "auth", "Provider sign-in required"],
  ["Please run codex login", "auth", "Provider sign-in required"],
  ["Session has expired", "auth", "Provider sign-in required"],
  [
    "spawn ENOENT: provider executable not found",
    "cli",
    "Command could not start",
  ],
  [
    "This session cannot use the MonoCode app CLI",
    "cli",
    "Command could not start",
  ],
  [
    "Transport disconnected: ECONNRESET",
    "transport",
    "Provider connection interrupted",
  ],
  ["Request timed out", "transport", "Provider connection interrupted"],
  ["Unexpected failure", "other", "Request could not finish"],
])("explains %s with an actionable error family", (error, family, title) => {
  expect(transcriptError(error)).toMatchObject({ family, title });
  expect(transcriptError(error).cause.length).toBeGreaterThan(10);
  expect(transcriptError(error).action.length).toBeGreaterThan(10);
});
