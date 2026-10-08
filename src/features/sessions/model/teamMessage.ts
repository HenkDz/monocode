import type { Block } from "./session";

/** The legacy envelope is still the provider prompt; its delivery guidance is not chat prose. */
export function parseTeamMessage(text: string) {
  const match = text.match(/^Team message from (.+) to (.+) \(([^\n]*)\):\r?\n([\s\S]*?)\r?\n\r?\nReply directly with app team\.message /);
  if (!match) return;
  const marker = match[4].match(/\n<team_sender>([^\n]+)<\/team_sender>$/);
  let sender: { id: string; name: string; mascot: string; color: string } | undefined;
  if (marker) {
    try {
      const value = JSON.parse(marker[1]);
      if (value && [value.id, value.name, value.mascot, value.color].every(field => typeof field === "string" && field.length > 0 && field.length <= 256)) sender = value;
    } catch { /* A legacy or malformed marker uses the envelope's display name. */ }
  }
  return { id: sender?.id ?? match[1], name: sender?.name ?? match[1], mascot: sender?.mascot ?? "cat", color: sender?.color ?? "#888", topic: match[3], text: marker ? match[4].slice(0, marker.index) : match[4] };
}

export function teamMessage(block: Block) {
  return block.monoTeamMessage ?? (block.role === "user" ? parseTeamMessage(block.text) : undefined) ??
    (block.monoSource ? { ...block.monoSource, text: block.text, topic: "Goal" } : undefined);
}

export function isUserMessage(block: Block): boolean {
  return block.role === "user" && !teamMessage(block);
}
