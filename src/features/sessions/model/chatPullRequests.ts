import type { Block } from "./session";
import {
  prIdentity,
  prUrls,
  type WorktreePr,
} from "../../source-control/model/pullRequests";

export type ChatPrTurn = {
  entries: WorktreePr[];
  actionEntries?: WorktreePr[];
  action?: "Opened" | "Updated" | "Ready" | "Merged";
};

/** Derive references from every turn so old transcripts need no stored-block migration. */
export function chatPrTurns(
  blocks: readonly Block[],
  entries: readonly WorktreePr[],
  repo?: string,
): Map<string, ChatPrTurn> {
  const turns = new Map<string, Block[]>();
  let turnId: string | undefined;
  for (const block of blocks) {
    if (block.role === "user") {
      turnId = block.id;
      turns.set(turnId, []);
    }
    if (
      turnId &&
      ["assistant", "tool"].includes(block.role) &&
      !block.streaming
    )
      turns.get(turnId)!.push(block);
  }
  const result = new Map<string, ChatPrTurn>();
  for (const [id, turn] of turns) {
    const text = turn
      .flatMap((block) => [
        block.text,
        block.monoCard?.type === "pr" && (block.monoCard.repo ?? repo)
          ? `https://github.com/${block.monoCard.repo ?? repo}/pull/${block.monoCard.number}`
          : undefined,
        block.tool?.title,
        block.tool?.detail,
        block.tool?.preview?.output,
        ...(block.tool?.preview?.lines?.map((line) => line.text) ?? []),
        ...(block.agentRun?.steps?.flatMap((step) => [
          step.text,
          step.detail,
          step.preview?.output,
        ]) ?? []),
      ])
      .filter(Boolean)
      .join("\n");
    const urls = prUrls(text).map(prIdentity);
    const mentioned = entries.filter(
      (entry) =>
        urls.includes(prIdentity(entry.pr.url)) ||
        (!urls.length &&
          new RegExp(
            `(?:PR|pull request)\\s*#?${entry.pr.number}\\b|#${entry.pr.number}\\b`,
            "i",
          ).test(text)),
    );
    if (!mentioned.length) continue;
    // Lifecycle claims must name a PR in the same clause; cleanup reports stay references.
    const clauses = text.split(/[\n.;]/);
    const acts = mentioned
      .map((entry) => {
        const number = `(?:PR|pull request)\\s*#?${entry.pr.number}\\b`;
        const matches = (verb: string) =>
          clauses.some((clause) =>
            new RegExp(
              `(?:${verb})\\s+(?:a\\s+|the\\s+)?${number}|${number}\\s+(?:is\\s+|was\\s+)?(?:${verb})\\b`,
              "i",
            ).test(clause),
          );
        const single = mentioned.length === 1;
        const action: ChatPrTurn["action"] = matches(
          "merged by (?:you|the user)",
        )
          ? "Merged"
          : entry.pr.state !== "open"
            ? undefined
            : matches("marked ready|ready to merge") ||
                (single && /\bgh\s+pr\s+ready\b/.test(text))
              ? "Ready"
              : matches("opened|created") ||
                  (single && /\bgh\s+pr\s+create\b/.test(text))
                ? "Opened"
                : matches("updated|pushed (?:new )?commits to") ||
                    (single && /\b(?:gh\s+pr\s+edit|git\s+push)\b/.test(text))
                  ? "Updated"
                  : undefined;
        return { entry, action };
      })
      .filter((value) => value.action);
    const action = acts[0]?.action;
    result.set(id, {
      entries: mentioned,
      ...(action
        ? {
            actionEntries: acts
              .filter((value) => value.action === action)
              .map((value) => value.entry),
            action,
          }
        : { action: undefined }),
    });
  }
  return result;
}
