import { useState } from "react";
import { PixelMascot } from "../../projects/ui/PixelMascot";
import { AgentMarkdown } from "./AgentMarkdown";
import type { teamMessage } from "../model/teamMessage";
import { listMonos, monoLook } from "../../monos/model/mono";

export function TeamMessage({ message, cwd }: { message: NonNullable<ReturnType<typeof teamMessage>>; cwd?: string }) {
  const [expanded, setExpanded] = useState(false);
  const sender = listMonos(true).find(mono => mono.id === message.id || mono.name === message.name);
  const look = sender && monoLook(sender);
  const long = message.text.length > 320 || message.text.split(/\r?\n/).length > 4;
  return <div data-team-message={message.id} className="mr-auto my-3 max-w-[85%] rounded-xl border border-content/10 bg-content/5 p-3 text-left font-sans text-sm">
    <div className="mb-2 flex items-center gap-2 text-xs">
      <PixelMascot name={look?.mascot ?? message.mascot} color={look?.color ?? message.color} still className="size-6 shrink-0" />
      <strong>{message.name}</strong><span className="text-content/50">Team message</span>
    </div>
    <AgentMarkdown className={long && !expanded ? "line-clamp-4" : undefined} text={message.text} cwd={cwd} />
    {long && <button type="button" className="mt-1 text-xs text-content/65 hover:underline" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? "Show less" : "Show more"}</button>}
  </div>;
}
