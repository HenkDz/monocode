import type { Block } from "./session";
import { isHiddenTool, isNoticeBlock, isProseBlock, needsApproval, toolCallState } from "./transcriptActivity";
import { isEditTool } from "../../../integrations/harness/core/preview";

/** Keep work intact; only a result or a request for the reader escapes the fold. */
export function compactTurn(blocks: Block[], settled: boolean, pendingQuestion = false, managed = false) {
  const visible = blocks.filter(block => (!block.internal || managed) && !block.orchestration && (needsApproval(block) || !isHiddenTool(block)));
  const lastAnswer = [...visible].reverse().find(isProseBlock);
  const terminal = [...visible].reverse().find(isNoticeBlock);
  const terminalAt = terminal ? visible.indexOf(terminal) : -1;
  const answerAt = lastAnswer ? visible.indexOf(lastAnswer) : -1;
  const failed = settled && terminalAt > answerAt;
  const question = pendingQuestion && lastAnswer && /(?:[?？]\s*$|^\s*(?:choose|select|decide)\b)/i.test(lastAnswer.text);
  const outside = new Set(visible.filter(block =>
    block.role === "user" || block.role === "handoff" || needsApproval(block) ||
    // Structured plans and request cards carry decisions, not progress narration.
    block.role === "plan" || block.monoCard || block.monoTeamChange ||
    (failed && block === terminal) ||
    (block === lastAnswer && !failed && (settled || question)),
  ));
  const work = visible.filter(block => !outside.has(block) &&
    (block.text.trim() || block.tool || block.image || block.taskList));
  const edits = new Set<string>();
  let failures = 0;
  for (const block of work) {
    if (block.tool && toolCallState(block) === "rejected") failures++;
    if (isEditTool(block.tool?.kind, block.text || block.tool?.title, block.tool?.preview)) {
      for (const path of block.tool?.paths ?? [block.tool?.preview?.path ?? block.tool?.preview?.fileName ?? block.id]) edits.add(path);
    }
  }
  return { visible, outside, work, edits: edits.size, failures };
}
