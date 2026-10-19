import { expect, it } from "vitest";
import { capabilityDecisionPayload, integrationWorkLine, parseCapabilityRequest } from "./integrationCapabilities";

const payload = () => ({ version: 1, type: "capability-request", kind: "access", service: "github", reason: "Review this project's PRs", tools: ["github.pr.read"], scopes: ["repo:github.com/acme/project"], deadline: 5000 });
it("parses bounded capability evidence without accepting identity or user impersonation", () => {
  expect(parseCapabilityRequest(payload())).toEqual(payload());
  for (const extra of [{ actor: "user" }, { accountId: "other" }, { binding: {} }, { approved: true }, { semantic: "read" }])
    expect(() => parseCapabilityRequest({ ...payload(), ...extra })).toThrow();
});
it("records protected decisions only as review requests, never operation permission", () => {
  const request = parseCapabilityRequest(payload());
  expect(capabilityDecisionPayload(request)).toMatchObject({ operation: "sign-in", impact: "high", options: [{ id: "review" }, { id: "later" }] });
  expect(capabilityDecisionPayload({ ...request, kind: "install", service: "skill", source: "C:/synthetic/skills/fixture" }).operation).toBe("install");
  expect(capabilityDecisionPayload({ ...request, kind: "merge" }).operation).toBe("merge");
});
it("rejects broad/empty/malformed requests and nonlocal skill installation claims", () => {
  for (const altered of [{ tools: [] }, { scopes: ["repo", "repo"] }, { deadline: Infinity }, { reason: "" }, { kind: "install", service: "github" }, { service: "skill" }, { tools: ["x\ny"] }])
    expect(() => parseCapabilityRequest({ ...payload(), ...altered })).toThrow();
});
it("returns one bounded plain-text work line for an actionable denial", () => {
  expect(integrationWorkLine("untrusted\nproxy", { action: "deny", code: "unknown-tool" })).toBe("untrusted proxy · blocked (unknown-tool)");
  expect(integrationWorkLine("github.pr.merge", { action: "ask" })).toBe("github.pr.merge · needs your approval");
});
