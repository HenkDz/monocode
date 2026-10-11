import { beforeEach, expect, it, vi } from "vitest";
const mono = vi.hoisted(() => ({ session: vi.fn(() => false), habit: vi.fn((): string | undefined => undefined) }));
const needsResume = vi.hoisted(() => vi.fn((_id: string, _provider: string | undefined) => false));
vi.mock("../../../features/monos/model/monoWorkingDirectoryMigration", () => ({ monoWorkingDirectoryNeedsResume: needsResume }));
vi.mock("../../../features/monos/model/mono", () => ({ isMonoSession: mono.session }));
vi.mock("../../../features/monos/model/monoHabits", () => ({ habitRunMono: mono.habit }));
import { canResumeMonoAfterCwdChange } from "./monoCwdResume";
const input = { sessionId: "chat", cwd: "/workspace", model: "claude:sonnet", runtimeMode: "supervised" as const, onEvent() {} };
const saved = { cwd: "/home", providerAccountId: "work" };
beforeEach(() => { mono.session.mockReturnValue(false); mono.habit.mockReturnValue(undefined); needsResume.mockReturnValue(false); });
it.each(["monoSession", "orgMono", "roster", "habit"])("preserves a same-account %s conversation after its folder moves", kind => {
  mono.session.mockReturnValue(kind === "roster");
  mono.habit.mockReturnValue(kind === "habit" ? "owner" : undefined);
  expect(canResumeMonoAfterCwdChange({ ...input, providerAccountId: "work", monoSession: kind === "monoSession", orgMono: kind === "orgMono" }, saved)).toBe(true);
});
it("keeps ordinary cwd changes and account changes outside the exception", () => {
  expect(canResumeMonoAfterCwdChange({ ...input, providerAccountId: "work" }, saved)).toBe(false);
  expect(canResumeMonoAfterCwdChange({ ...input, monoSession: true, providerAccountId: "other" }, saved)).toBe(false);
  expect(canResumeMonoAfterCwdChange({ ...input, monoSession: true, cwd: saved.cwd, providerAccountId: "work" }, saved)).toBe(false);
  expect(canResumeMonoAfterCwdChange({ ...input, monoSession: true }, undefined)).toBe(false);
});
it("treats legacy missing account IDs as the default account", () => {
  expect(canResumeMonoAfterCwdChange({ ...input, monoSession: true, providerAccountId: "default" }, { cwd: "/home" })).toBe(true);
});
it("retries a persisted folder migration only for its saved native conversation and account", () => {
  needsResume.mockImplementation((_id, provider) => provider === "saved");
  const retained = { ...saved, cwd: input.cwd, sessionId: "saved" };
  expect(canResumeMonoAfterCwdChange({ ...input, monoSession: true, providerAccountId: "work" }, retained)).toBe(true);
  expect(canResumeMonoAfterCwdChange({ ...input, monoSession: true, providerAccountId: "work" }, { ...retained, sessionId: "other" })).toBe(false);
  expect(canResumeMonoAfterCwdChange({ ...input, monoSession: true, providerAccountId: "other" }, retained)).toBe(false);
});
