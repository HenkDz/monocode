import { expect, it } from "vitest";
import { prepareTerminalCommand, takeTerminalCommand, forgetTerminalCommand } from "./terminalCommand";
it("consumes a clicked command once only for its exact checkout and active selection", () => {
  prepareTerminalCommand("fresh", "/checkout", "npm run test", () => true);
  expect(takeTerminalCommand("fresh", "/checkout")).toBe("npm run test");
  expect(takeTerminalCommand("fresh", "/checkout")).toBeUndefined();
  prepareTerminalCommand("wrong", "/checkout", "npm run test", () => true);
  expect(takeTerminalCommand("wrong", "/other")).toBeUndefined();
  expect(takeTerminalCommand("wrong", "/checkout")).toBeUndefined();
  prepareTerminalCommand("switched", "/checkout", "npm run test", () => false);
  expect(takeTerminalCommand("switched", "/checkout")).toBeUndefined();
  prepareTerminalCommand("failed", "/checkout", "npm run test", () => true); forgetTerminalCommand("failed");
  expect(takeTerminalCommand("failed", "/checkout")).toBeUndefined();
});
