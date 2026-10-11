import { expect, it, vi } from "vitest";
import { serializeMonoGoalUpdate } from "./monoGoalUpdates";

it("continues a session after a failed update", async () => {
  const read = vi.fn(async () => "saved");
  const failed = serializeMonoGoalUpdate("failed-origin", async () => { throw Error("Disk unavailable"); });
  const next = serializeMonoGoalUpdate("failed-origin", read);
  await expect(failed).rejects.toThrow("Disk unavailable");
  await expect(next).resolves.toBe("saved");
  expect(read).toHaveBeenCalledOnce();
});

it("does not block an unrelated originating session", async () => {
  let release!: () => void;
  const pending = serializeMonoGoalUpdate("busy-origin", () => new Promise<void>(resolve => { release = resolve; }));
  await expect(serializeMonoGoalUpdate("other-origin", async () => "saved")).resolves.toBe("saved");
  release();
  await pending;
});
