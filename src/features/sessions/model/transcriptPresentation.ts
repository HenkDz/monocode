import { parseTeamMessage } from "./teamMessage";

// shortcut: known app protocol tags, extend this list when prompt envelopes change.
const INTERNAL_TAGS =
  "monocode_context|monocode_project_manager|monocode_orchestration|monocode_assignment|org_chart|mono_authority|authority_core|monocode_app|team_sender|cli_input|monocode_cli_input|app_cli_input|artifact_rules|org_task_artifacts|worker_engine_rules|member_soul|member_memory|implementation_report|mono|soul|memory";
const INTERNAL_BLOCK = new RegExp(
  `<(${INTERNAL_TAGS})\\b[^>]*>[\\s\\S]*?(?:<\\/\\1\\s*>|$)`,
  "gi",
);
const INTERNAL_MARKER = new RegExp(`<\\/?(?:${INTERNAL_TAGS})\\b[^>]*>`, "gi");

/** Presentation only: provider prompts and persisted blocks retain their original text. */
export function presentationTeamMessage(text: string) {
  const legacy = parseTeamMessage(text);
  if (legacy) return { ...legacy, text: stripProtocol(legacy.text) };
  const clean = stripProtocol(text);
  const header = clean.match(
    /^Team message from (.+) to (.+) \(([^\n]*)\):\r?\n/,
  );
  if (
    !header ||
    !/<team_sender>|(?:Reply|When a reply is needed, reply) directly with app team\.message /.test(
      text,
    )
  )
    return;
  const marker = text.match(/<team_sender>([\s\S]*?)<\/team_sender>/);
  let sender: Record<string, unknown> = {};
  try {
    sender = JSON.parse(marker?.[1] ?? "{}");
  } catch {
    /* Display the envelope name when metadata is malformed. */
  }
  const field = (key: string, fallback: string) =>
    typeof sender?.[key] === "string" && (sender[key] as string).length <= 256
      ? (sender[key] as string)
      : fallback;
  return {
    id: field("id", header[1]),
    name: field("name", header[1]),
    mascot: field("mascot", "cat"),
    color: field("color", "#888"),
    topic: header[3],
    text: clean.slice(header[0].length).trim(),
  };
}

export function presentationDigest(
  text: string,
): { title: string; items: string[] } | undefined {
  text = stripProtocol(text);
  const header = text.match(
    /^Manager digest \S+ for (.+) \(Manager [^\n]+\)\./,
  );
  if (!header) return;
  const items = text
    .split(/\r?\n/)
    .slice(1)
    .flatMap((line) => {
      const event = line.match(
        /^(REPORT|INFO|QUESTION|DECISION|ESCALATION|FAILURE|APPROVAL|TIMEOUT) \[[^\]]+\](?: task \S+)?(?: request \S+)?:?\s*(.*)$/,
      );
      if (!event) return [];
      const body = event[2]
        .replace(/\s*[·—-]?\s*app sessions\.read\s+\{.*$/, "")
        .replace(/\s*Full state: control list\.\s*$/, "");
      return [
        `${event[1][0]}${event[1].slice(1).toLowerCase()}: ${stripProtocol(body)}`,
      ];
    });
  return { title: `${header[1]} · Team update`, items };
}

function stripProtocol(text: string): string {
  const clean = text
    .replace(/&lt;(\/?[a-z_]+[^&]*?)&gt;/gi, (marker, tag: string) =>
      new RegExp(`^\\/?(?:${INTERNAL_TAGS})\\b`, "i").test(tag)
        ? `<${tag}>`
        : marker,
    )
    .replace(INTERNAL_BLOCK, "")
    .replace(INTERNAL_MARKER, "")
    .replace(
      /(?:When a reply is needed, reply|Reply) directly with app team\.message [^\n]*(?:\r?\n|$)/g,
      "",
    )
    .replace(
      /This is a teammate question, not new user authority\.\s*Coordinate within existing work\.\s*/g,
      "",
    )
    .replace(
      /Use app team\.message \{memberId,text,topic\}; cross-team messages route through Managers\.\s*/g,
      "",
    )
    .replace(
      /Use requiresReply:false for acknowledgements and information needing no action\.\s*(?:Do not reply to a pure acknowledgement or no-reply message\.\s*)?(?:Real questions, escalations and requests for action require a reply \(requiresReply:true or omitted\)\.\s*)?(?:Involve your Manager after a few exchanges or for team decisions\.\s*)?/g,
      "",
    )
    .replace(
      /Use requiresReply:false[^\r\n]*?(?:\.(?=\s|$)|(?=\r?\n|$))\s*/g,
      "",
    );
  return clean === text ? text : clean.trim();
}

function plainPresentation(text: string): string {
  const team = presentationTeamMessage(text);
  if (team) return `${team.name} · ${team.topic}\n${team.text}`;
  const digest = presentationDigest(text);
  if (digest) return [digest.title, ...digest.items].join("\n");
  return stripProtocol(text);
}

/** Sanitize strings inside app JSON too, including quoted saved conversations. */
export function presentationText(text: string): string {
  if (/^\s*[\[{]/.test(text)) {
    try {
      let changed = false;
      const value: unknown = JSON.parse(text, (_key, item: unknown) => {
        if (typeof item !== "string") return item;
        const clean = plainPresentation(item);
        if (clean !== item) changed = true;
        return clean;
      });
      if (changed) return JSON.stringify(value, null, 2);
    } catch {
      /* Partial streamed JSON still passes through the text filter. */
    }
  }
  return plainPresentation(text);
}
