import type { Block } from "./session";
import type { OrchestrationRun } from "../../orchestration/model/orchestrationState";
import { transcriptError } from "./transcriptError";

export function sessionAuthDiagnostics(
  blocks: readonly Pick<Block, "role" | "notice" | "text">[],
  runs: readonly OrchestrationRun[],
): string | undefined {
  const errors: string[] = [];
  for (let index = blocks.length - 1; index >= 0; index--) {
    const block = blocks[index];
    if (block.role === "user") break;
    if (block.role === "system" && block.notice === "error" && transcriptError(block.text).family === "auth")
      errors.unshift(block.text);
  }
  for (const run of runs) {
    const error = run.error || run.lastPauseReason;
    if (run.status === "paused" && !run.recovering && error && transcriptError(error).family === "auth" && !errors.includes(error))
      errors.push(error);
  }
  return errors.length ? errors.join("\n\n") : undefined;
}
