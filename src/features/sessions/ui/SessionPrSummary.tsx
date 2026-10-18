import { pullRequestLabel } from "../../source-control/model/pullRequests";
import { type ChatPrTurn } from "../model/chatPullRequests";
import { openPullRequests } from "../../pullRequests/model/pullRequestView";

export function SessionPrSummary({ turn }: { turn: ChatPrTurn }) {
  const { entries, action } = turn;
  if (!entries.length) return null;
  const acted = turn.actionEntries ?? entries;
  const pr = acted[0];
  const summary = entries.every((entry) => entry.pr.state === "merged")
    ? "all merged"
    : entries.every((entry) => entry.pr.state !== "open")
      ? "all settled"
      : `${entries.filter((entry) => entry.pr.state === "open").length} open`;
  return (
    <button
      type="button"
      className="max-w-full truncate rounded px-2 py-1 text-xs text-content/60 hover:bg-content/5 hover:text-content focus-visible:outline-accent"
      onClick={() =>
        openPullRequests({ urls: entries.map((entry) => entry.pr.url) })
      }
    >
      {action
        ? `${action === "Ready" ? `PR #${pr.pr.number} ready to merge` : `${action} PR #${pr.pr.number}`}${acted.length > 1 ? ` +${acted.length - 1}` : ""} · ${pr.pr.checksStatus === "pending" && pr.pr.state === "open" ? "checks running" : pullRequestLabel(pr).toLowerCase()}`
        : `${entries.length} ${entries.length === 1 ? "PR" : "PRs"} referenced · ${summary}`}{" "}
      ›
    </button>
  );
}
