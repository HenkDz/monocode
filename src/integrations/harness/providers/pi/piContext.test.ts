import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SendTurnInput } from "../../core/types";

const mocks = vi.hoisted(() => ({
  request: vi.fn(), spawnChild: vi.fn(),
  frames: [] as Array<(record: Record<string, unknown>) => void>,
}));
vi.mock("../../core/child", () => ({
  killChild: async () => {}, resolveOmpBinary: async () => ({ path: "/synthetic/omp" }),
  resolvePiBinary: async () => ({ path: "/synthetic/pi" }), spawnChild: mocks.spawnChild,
  unwatchChild: () => {}, watchChild: () => {}, writeChild: async () => {},
}));
vi.mock("./piClient", () => ({
  PiRpc: class {
    constructor(_id: string, onFrame: (record: Record<string, unknown>) => void) { mocks.frames.push(onFrame); }
    request = mocks.request;
    close() {}
    cancelRequest() {}
    pushLine() {}
  },
}));
import { bindPiSession, sendPiTurn, stopPiSession } from "./pi";
import { bindOmpSession, sendOmpTurn, stopOmpSession } from "../omp/omp";

beforeEach(() => {
  mocks.request.mockReset(); mocks.spawnChild.mockReset(); mocks.frames.length = 0;
});
afterEach(async () => {
  await stopPiSession("pi-continuity"); await stopOmpSession("omp-continuity");
});

describe.each([
  ["pi", bindPiSession, sendPiTurn], ["omp", bindOmpSession, sendOmpTurn],
] as const)("%s confirmed prompt context", (flavor, bind, send) => {
  it.each(["failed", "replaced", "unknown", "retained"])("plans before submission after a %s resume", async mode => {
    const id = `${flavor}-continuity`;
    bind(id, "old", "/synthetic");
    let reads = 0;
    let prepared = false;
    const confirmed = mode === "unknown" ? undefined : mode === "retained" ? "old" : "fresh";
    mocks.request.mockImplementation(async (command: Record<string, unknown>) => {
      if (command.type === "get_state") {
        if (mode === "failed" && reads++ === 0) throw new Error("Saved session missing");
        return { data: confirmed ? { sessionId: confirmed } : {} };
      }
      if (command.type === "prompt") {
        expect(prepared).toBe(true);
        expect(command.message).toBe(mode === "retained" ? "Continue" : "Full context\nContinue");
        queueMicrotask(() => mocks.frames.at(-1)!({ type: "agent_end", messages: [] }));
      }
      return { data: {} };
    });
    const prepareText = vi.fn<NonNullable<SendTurnInput["prepareText"]>>(async provider => {
      expect(provider).toBe(confirmed);
      prepared = true;
      return provider === "old" ? "Continue" : "Full context\nContinue";
    });
    await send({ sessionId: id, cwd: "/synthetic", model: `${flavor}:default`, runtimeMode: "supervised", text: "Continue", prepareText, onEvent() {} });
    expect(prepareText).toHaveBeenCalledExactlyOnceWith(confirmed);
    expect(mocks.spawnChild).toHaveBeenCalledTimes(mode === "failed" ? 2 : 1);
  });
});
