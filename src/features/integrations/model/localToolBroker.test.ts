// @vitest-environment happy-dom
import { expect, it, vi } from "vitest";
import { executeLocalTool, isIntegrationUserEvent, type LocalToolBrokerHost, type LocalToolReceipt } from "./localToolBroker";
import { integrationFixture } from "./localToolFixtures.test-support";

function fixture() {
  const state = integrationFixture();
  const receipts = new Map<string, LocalToolReceipt>();
  const host: LocalToolBrokerHost = {
    now: () => 1000, current: () => ({ context: state.context, grant: state.grant }),
    reserve: vi.fn(async (receipt, _approval, validate) => { validate(); if (receipts.has(receipt.requestId)) return false; receipts.set(receipt.requestId, receipt); return true; }),
    record: vi.fn(async receipt => { receipts.set(receipt.requestId, receipt); }),
    execute: vi.fn(async (_call, validate) => { validate(); return { content: "synthetic" }; }),
  };
  return { ...state, host, receipts };
}

it("reserves durably before one invocation and refuses replay after a host reload", async () => {
  const { call, host, receipts } = fixture();
  expect(await executeLocalTool(call, host)).toEqual({ content: "synthetic" });
  expect(receipts.get(call.requestId)?.state).toBe("completed");
  await expect(executeLocalTool(call, { ...host })).rejects.toThrow("already reserved");
  expect(host.execute).toHaveBeenCalledTimes(1);
});
it("blocks concurrent duplicates and changed args under the original request ID", async () => {
  const { call, host } = fixture();
  const results = await Promise.allSettled([executeLocalTool(call, host), executeLocalTool(call, host)]);
  expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
  call.args.url = "https://github.com/acme/project/pull/2";
  await expect(executeLocalTool(call, host)).rejects.toThrow("already reserved");
  expect(host.execute).toHaveBeenCalledTimes(1);
});
it("does not invoke after reservation save failure", async () => {
  const { call, host } = fixture(); host.reserve = vi.fn(async () => { throw Error("save failed"); });
  await expect(executeLocalTool(call, host)).rejects.toThrow("save failed");
  expect(host.execute).not.toHaveBeenCalled();
});
it.each(["reserve", "execute", "record"] as const)("revalidates Stop across %s await", async stage => {
  const { call, host, context, receipts } = fixture();
  const original = host[stage];
  host[stage] = vi.fn(async (...args: never[]) => { const result = await (original as (...args: never[]) => Promise<unknown>)(...args); context.active = false; return result; }) as never;
  await expect(executeLocalTool(call, host)).rejects.toThrow();
  expect(receipts.get(call.requestId)?.state).toBe("uncertain");
  expect(host.execute).toHaveBeenCalledTimes(stage === "reserve" ? 0 : 1);
});
it("retains uncertainty on operation failure, without retry", async () => {
  const { call, host, receipts } = fixture(); host.execute = vi.fn(async () => { throw Error("outcome unknown"); });
  await expect(executeLocalTool(call, host)).rejects.toThrow("outcome unknown");
  expect(receipts.get(call.requestId)?.state).toBe("uncertain");
  await expect(executeLocalTool(call, host)).rejects.toThrow("already reserved");
  expect(host.execute).toHaveBeenCalledTimes(1);
});
it("keeps the original reservation when final persistence fails", async () => {
  const { call, host, receipts } = fixture(); host.record = vi.fn(async () => { throw Error("receipt write failed"); });
  await expect(executeLocalTool(call, host)).rejects.toThrow("receipt write failed");
  expect(receipts.get(call.requestId)?.state).toBe("reserved");
  await expect(executeLocalTool(call, host)).rejects.toThrow("already reserved");
  expect(host.execute).toHaveBeenCalledTimes(1);
});
it("does not approve protected execution through synthetic UI, CLI or decision evidence", async () => {
  const { call, host, grant } = fixture(); call.tool = "github.pr.merge"; grant.tools[0].id = call.tool;
  call.args = { ...call.args, expectedHead: "a".repeat(40), expectedBase: "main" };
  for (const event of [undefined, new MouseEvent("click"), new Event("submit")]) {
    expect(isIntegrationUserEvent(event, call.requestId)).toBe(false);
    await expect(executeLocalTool(call, host, event)).rejects.toThrow("direct explicit approval");
  }
  expect(host.reserve).not.toHaveBeenCalled(); expect(host.execute).not.toHaveBeenCalled();
});
it("captures the original call and grant before awaits", async () => {
  const { call, host, grant } = fixture(); const reserve = host.reserve;
  host.reserve = async (...args) => { const result = await reserve(...args); grant.tools[0].scopes.push("extra"); return result; };
  await expect(executeLocalTool(call, host)).rejects.toThrow("approval changed");
  expect(host.execute).not.toHaveBeenCalled();
});
