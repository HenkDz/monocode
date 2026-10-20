import { expect, it } from "vitest";
import { capabilityDecisionPayload, capabilityDecisionReason, installCapabilityRequest, integrationWorkLine, parseCapabilityRequest, type InstallCapabilityRequest } from "./integrationCapabilities";
import { decisionAsk, parseDecisionPayload } from "../../monos/model/monoDecisions";
import type { Mono } from "../../monos/model/mono";

const payload = () => ({ version: 1, type: "capability-request", kind: "access", service: "github", reason: "Review this project's PRs", tools: ["github.pr.read"], scopes: ["repo:github.com/acme/project"], deadline: 5000 });
const install = (): InstallCapabilityRequest => ({ version: 1, type: "capability-request", kind: "install", service: "skill", name: "fixture", source: "C:\\synthetic\\skills\\fixture",
  reason: "Read this project with the fixture skill", tools: ["project.skill.install"], scopes: ["project:synthetic"], deadline: 5000 });
it("parses bounded capability evidence without accepting identity or user impersonation", () => {
  expect(parseCapabilityRequest(payload())).toEqual(payload());
  for (const extra of [{ actor: "user" }, { accountId: "other" }, { binding: {} }, { approved: true }, { semantic: "read" }])
    expect(() => parseCapabilityRequest({ ...payload(), ...extra })).toThrow();
});
it("records protected decisions only as review requests, never operation permission", () => {
  const request = parseCapabilityRequest(payload());
  expect(capabilityDecisionPayload(request)).toMatchObject({ operation: "sign-in", impact: "high", options: [{ id: "review" }, { id: "later" }] });
  expect(capabilityDecisionPayload(install()).operation).toBe("install");
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

it("round-trips explicit install evidence through the actual ordinary Ask parser with host-derived identity and readable reason", () => {
  const request = install(), wire = capabilityDecisionPayload(request), project = "C:/synthetic/project";
  const roster: Mono[] = [
    { id: "boss", role: "orchestrator", projects: [], mascot: "b", color: "blue" },
    { id: "manager", role: "manager", reportsTo: "boss", projects: [project], mascot: "m", color: "blue" },
    { id: "worker", role: "member", reportsTo: "manager", projects: [project], mascot: "w", color: "blue" },
  ];
  expect(parseDecisionPayload(JSON.parse(JSON.stringify(wire)))).toEqual(wire);
  const ask = decisionAsk({ id: "worker-chat:ask", managerId: "manager", senderId: "worker", recipientId: "manager", topic: "skill", kind: "question", requiresReply: true, at: 1,
    text: JSON.stringify(wire) }, "worker-chat", project, roster, "high-impact-only", { goalId: "goal", taskId: "task" })!;
  expect(ask).toMatchObject({ requestingMonoId: "worker", requesterSessionId: "worker-chat", projectId: project, goalId: "goal", taskId: "task", answererId: "user", status: "waiting" });
  expect(installCapabilityRequest(ask)).toEqual(request);
  expect(capabilityDecisionReason(ask)).toBe(request.reason);
  expect(ask).not.toHaveProperty("installed"); expect(ask).not.toHaveProperty("approved");
  expect(installCapabilityRequest({ ...ask, status: "answered" } as typeof ask)).toEqual(request);
});

it("never infers install metadata from prose, missing fields, nonlocal paths or identity claims", () => {
  const wire = capabilityDecisionPayload(install());
  for (const altered of [{ name: undefined }, { source: undefined }, { name: "../fixture" }, { name: "a".repeat(65) },
    { source: "https://example.invalid/skill" }, { source: "relative/fixture" }, { source: "C:/synthetic/../private" }, { source: "C:/synthetic/\nfixture" },
    { requesterSessionId: "forged" }, { projectId: "other" }, { approved: true }]) {
    const value = { ...install(), ...altered };
    expect(() => parseCapabilityRequest(value)).toThrow();
    expect(installCapabilityRequest({ ...wire, context: JSON.stringify(value) })).toBeUndefined();
  }
  expect(installCapabilityRequest({ ...wire, context: "Install fixture from C:/synthetic/skills/fixture" })).toBeUndefined();
  expect(installCapabilityRequest({ ...wire, operation: "work" })).toBeUndefined();
  expect(installCapabilityRequest({ ...wire, context: JSON.stringify(payload()) })).toBeUndefined();
  expect(() => parseDecisionPayload({ ...wire, source: install().source })).toThrow();
  expect(capabilityDecisionReason({ ...wire, context: "Please inspect the skill first" })).toBe("Please inspect the skill first");
});

it("uses the existing exact 2000-character context cap and refuses overflow without truncating evidence", () => {
  const request = install();
  request.reason = "r".repeat(2000 - JSON.stringify(request).length + request.reason.length);
  const wire = capabilityDecisionPayload(request);
  expect(wire.context).toHaveLength(2000);
  expect(installCapabilityRequest(parseDecisionPayload(wire))).toEqual(request);
  expect(capabilityDecisionReason(wire)).toBe(request.reason);
  expect(() => capabilityDecisionPayload({ ...request, reason: `${request.reason}r` })).toThrow();
  expect(installCapabilityRequest({ ...wire, context: `${wire.context} ` })).toBeUndefined();
});
