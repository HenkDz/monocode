import { expect, it } from "vitest";
import { chatPrTurns } from "./chatPullRequests";
import type { Block } from "./session";
import type { WorktreePr } from "../../source-control/model/pullRequests";

const entries: WorktreePr[] = [1, 2].map((number) => ({
  cwd: "/repo",
  verifiedAt: 1,
  links: [],
  pr: {
    number,
    title: "Fix",
    url: `https://github.com/example/repo/pull/${number}`,
    state: "merged",
  },
}));
const turn = (text: string): Block[] => [
  { id: "u", role: "user", text: "Report" },
  { id: "a", role: "assistant", text },
];

it("derives one reference summary for settled cleanup reports and each later turn", () => {
  const blocks = [
    ...turn("PR #1 merged; PR #2 closed."),
    { id: "next", role: "user" as const, text: "Again" },
    {
      id: "later",
      role: "assistant" as const,
      text: "See https://github.com/example/repo/pull/1",
    },
  ];
  const result = chatPrTurns(blocks, entries);
  expect(result.get("u")).toEqual({ entries, action: undefined });
  expect(result.get("next")).toEqual({
    entries: [entries[0]],
    action: undefined,
  });
});

it.each([
  ["Opened PR #1", "Opened"],
  ["Updated PR #1", "Updated"],
  ["PR #1 ready to merge", "Ready"],
  ["PR #1 merged by you", "Merged"],
])("classifies %s as a lifecycle line", (text, action) => {
  expect(
    chatPrTurns(
      turn(text),
      entries.map((entry) => ({
        ...entry,
        pr: { ...entry.pr, state: "open" },
      })),
    ).get("u")?.action,
  ).toBe(action);
});

it("shows the acted PR even when settled references precede it, and treats historical opening as a reference", () => {
  const open = { ...entries[1], pr: { ...entries[1].pr, state: "open" } };
  const result = chatPrTurns(turn("PR #1 merged. Opened PR #2."), [
    entries[0],
    open,
  ]).get("u")!;
  expect(result.actionEntries).toEqual([open]);
  expect(
    chatPrTurns(turn("Opened PR #1 (merged last week)."), entries).get("u")
      ?.action,
  ).toBeUndefined();
  expect(
    chatPrTurns(turn("PR #1 was ready to merge last week. Opened PR #2."), [
      entries[0],
      open,
    ]).get("u")?.action,
  ).toBe("Opened");
});

it("does not promote vague lifecycle words or streamed output", () => {
  expect(
    chatPrTurns(turn("Earlier I opened PRs. References: #1, #2."), entries).get(
      "u",
    )?.action,
  ).toBeUndefined();
  expect(
    chatPrTurns(
      [
        { id: "u", role: "user", text: "Open" },
        { id: "a", role: "assistant", text: "Opened PR #1", streaming: true },
      ],
      entries,
    ).size,
  ).toBe(0);
});

it("aggregates stored explicit PR blocks in one turn summary", () => {
  const blocks: Block[] = [
    { id: "u", role: "user", text: "Cleanup" },
    ...entries.map((entry) => ({
      id: `card-${entry.pr.number}`,
      role: "assistant" as const,
      text: "",
      monoCard: {
        type: "pr" as const,
        repo: "example/repo",
        number: entry.pr.number,
      },
    })),
  ];
  expect(chatPrTurns(blocks, entries).get("u")).toEqual({
    entries,
    action: undefined,
  });
});
