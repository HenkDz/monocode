import { expect, it } from "vitest";
import { isHarnessAuthError, latestTurnNeedsHarnessLogin } from "../../../integrations/harness/core/authSupport";
import { sessionAuthDiagnostics } from "./sessionAuthDiagnostics";
import type { OrchestrationRun } from "../../orchestration/model/orchestrationState";

const error = (text: string) => ({ role: "system" as const, notice: "error" as const, text });
const paused = (text: string) => ({ status: "paused", error: text, tasks: [] }) as unknown as OrchestrationRun;
it.each(["HTTP 401 Unauthorized\r\ncf-ray: synthetic\r\nrequest: preserved", "Missing bearer token", "Unauthenticated", "Codex login has expired", "Session has expired", "invalid access token"])("classifies and preserves %s through hydration", text => {
  expect(isHarnessAuthError(text)).toBe(true);
  expect(latestTurnNeedsHarnessLogin([error(text)])).toBe(true);
  expect(sessionAuthDiagnostics(JSON.parse(JSON.stringify([error(text)])), [paused(text)])).toBe(text);
});
it("keeps every repeated diagnostic byte while removing only the duplicate Manager notice", () => {
  const text = "401\r\nMissing bearer\r\ncf-ray: test";
  const blocks = [error(text), error(text)];
  const runs = [paused(text), paused("Login required")];
  const before = JSON.stringify({ blocks, runs });
  expect(sessionAuthDiagnostics(blocks, runs)).toBe(`${text}\n\n${text}\n\nLogin required`);
  expect(JSON.stringify({ blocks, runs })).toBe(before);
  expect(sessionAuthDiagnostics([...blocks, { role: "user", text: "New request", notice: undefined }], [])).toBeUndefined();
});
it("does not turn policy, access, storage, or ordinary failures into sign-in", () => {
  for (const text of ["Manager needs approval", "sandbox access denied", "storage launch mismatch; login required", "HTTP 429", "Transport disconnected"]) {
    expect(sessionAuthDiagnostics([error(text)], [paused(text)])).toBeUndefined();
  }
  expect(sessionAuthDiagnostics([], [{ ...paused("401"), recovering: true }])).toBeUndefined();
});
