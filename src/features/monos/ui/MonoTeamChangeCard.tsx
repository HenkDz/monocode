import { useState, useSyncExternalStore } from "react";
import {
  findMono,
  listMonos,
  monoLook,
  monosSnapshot,
  subscribeMonos,
} from "../model/mono";
import { reviewerModelWarning, undoMonoTeamChanges } from "../model/monoTeam";
import { monoTeamHost } from "../model/monoTeamRuntime";
import { PixelMascot } from "../../projects/ui/PixelMascot";
import { OrgArtifactLinks } from "../../artifacts/ui/OrgArtifactLinks";
import { Modal } from "../../../shared/ui/Modal";
import { formatRelativeTime } from "../../inbox/model/githubTasks";

const plainSoul = (text: string) =>
  text
    .replace(/^\s*#{1,6}\s+.*$/gm, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[`*_]/g, "")
    .replace(/^\s*(?:>|[-+])\s*/gm, "")
    .replace(/\s+/g, " ")
    .trim();

export function MonoTeamChangeCard({
  managerId,
  changeId,
  changeIds,
}: {
  managerId: string;
  changeId: string;
  changeIds?: string[];
}) {
  useSyncExternalStore(subscribeMonos, monosSnapshot);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const manager = listMonos(true).find((mono) => mono.id === managerId);
  const receipts = manager?.teamChanges ?? [];
  const changes = (changeIds ?? [changeId]).flatMap(
    (id) => receipts.find((change) => change.id === id) ?? [],
  );
  if (!changes.length) return null;
  const title = changes.every((change) => change.action === "team.hire")
    ? "Team hired"
    : "Team updated";
  const rows = [
    ...new Map(changes.map((change) => [change.memberId, change])).values(),
  ];
  const undone = changes.every((change) => change.undoneAt);
  const needsAttention =
    changes.some(
      (change) => change.error || change.warning || change.state !== "applied",
    ) ||
    rows.some((change) =>
      reviewerModelWarning(
        findMono(change.memberId) ?? change.after ?? change.before,
        listMonos(),
      ),
    );
  const at = Math.max(...changes.map((change) => change.at));
  const button =
    "rounded-md px-2.5 py-1.5 hover:bg-content/8 focus-visible:outline-accent disabled:opacity-40";
  return (
    <section
      aria-label={title}
      className="min-w-0 overflow-hidden rounded-xl border border-content/20 bg-content/5 p-3 font-sans text-xs shadow-sm"
    >
      <div className="flex items-center justify-between gap-3">
        <span
          className={`shrink-0 rounded-md px-1.5 py-0.5 ${needsAttention ? "bg-amber-500/10 text-amber-700 dark:text-amber-400" : "bg-content/5 text-content/60"}`}
        >
          {undone ? "Undone" : needsAttention ? "Needs attention" : "Applied"}
        </span>
        <h3 className="min-w-0 flex-1 truncate text-sm font-medium">
          {title}{" "}
          <span className="text-xs text-content/60">
            · {rows.length} {rows.length === 1 ? "member" : "members"}
          </span>
        </h3>
        <button
          type="button"
          aria-haspopup="dialog"
          className={`${button} shrink-0 bg-content/8 font-medium`}
          onClick={() => setOpen(true)}
        >
          Open
        </button>
      </div>
      <div className="mt-2 flex min-w-0 items-center gap-2">
        {rows.map((change) => {
          const look = monoLook(
            findMono(change.memberId) ?? change.after ?? change.before,
          );
          return (
            <span
              key={change.memberId}
              className="flex min-w-0 items-center gap-1.5"
              title={look.name}
            >
              <PixelMascot
                name={look.mascot}
                color={look.color}
                still
                className="size-4 shrink-0"
              />
              <span className="truncate text-content/60">{look.name}</span>
            </span>
          );
        })}
        <time
          dateTime={new Date(at).toISOString()}
          className="ml-auto shrink-0 text-content/50"
        >
          {formatRelativeTime(new Date(at).toISOString())}
        </time>
      </div>
      <OrgArtifactLinks
        monoId={managerId}
        links={[{ id: manager?.teamPlanArtifactId, label: "Team plan" }]}
      />
      {open && (
        <Modal title={title} fitViewport onClose={() => setOpen(false)}>
          <div
            className="p-4 text-xs"
            onClickCapture={(event) => {
              if (
                event.target instanceof Element &&
                event.target.closest("[data-org-artifact]")
              )
                setOpen(false);
            }}
          >
            <div className="flex items-center justify-between gap-3">
              <p className="text-content/60">
                {rows.length} {rows.length === 1 ? "member" : "members"}
              </p>
              <button
                type="button"
                disabled={
                  busy ||
                  undone ||
                  changes.some((change) => change.state !== "applied")
                }
                className={button}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await undoMonoTeamChanges(
                      managerId,
                      changes.map((change) => change.id),
                      await monoTeamHost(managerId),
                    );
                    setError(undefined);
                  } catch (error) {
                    setError(String(error));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {undone ? "Undone" : busy ? "Undoing…" : "Undo"}
              </button>
            </div>
            <OrgArtifactLinks
              monoId={managerId}
              links={[{ id: manager?.teamPlanArtifactId, label: "Team plan" }]}
            />
            {rows.map((change) => {
              const member =
                findMono(change.memberId) ?? change.after ?? change.before;
              const look = monoLook(member);
              const memberChanges = changes.filter(
                (receipt) => receipt.memberId === change.memberId,
              );
              const soul = plainSoul(
                [...memberChanges]
                  .reverse()
                  .find((receipt) => receipt.files?.soul)?.files?.soul?.after ??
                  member.instructions ??
                  "",
              );
              const summary = soul.match(/^.*?[.!?](?=\s|$)/)?.[0] ?? soul;
              const warning =
                reviewerModelWarning(member, listMonos()) ??
                memberChanges.find((receipt) => receipt.warning)?.warning;
              return (
                <div
                  key={change.id}
                  data-team-member={change.memberId}
                  className="mt-2 flex min-w-0 items-start gap-3 border-t border-content/10 pt-3"
                >
                  <PixelMascot
                    name={look.mascot}
                    color={look.color}
                    still
                    className="size-8 shrink-0"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <strong className="truncate text-sm font-medium">
                        {look.name}
                      </strong>
                      <span className="rounded-md bg-content/5 px-1.5 py-0.5 text-content/60">
                        {member.specialty ?? "Member"}
                      </span>
                      {member.workerProfile && (
                        <span
                          title={member.workerProfile.harness}
                          className="rounded-md bg-content/5 px-1.5 py-0.5 text-content/60"
                        >
                          {member.workerProfile.model}
                        </span>
                      )}
                      {change.action === "team.retire" && (
                        <span className="text-content/50">Retired</span>
                      )}
                    </div>
                    {summary && (
                      <p
                        className="mt-1 truncate text-content/60"
                        title={summary}
                      >
                        {summary}
                      </p>
                    )}
                    {soul.length > summary.length && (
                      <p className="mt-2 whitespace-pre-wrap break-words text-content/60">
                        {soul}
                      </p>
                    )}
                    {change.action !== "team.hire" && (
                      <p className="mt-1 text-content/60">{change.summary}</p>
                    )}
                    {warning && (
                      <p className="mt-1 text-amber-700 dark:text-amber-400">
                        {warning}
                      </p>
                    )}
                    {change.error && (
                      <p
                        role="alert"
                        className="mt-1 text-red-700 dark:text-red-400"
                      >
                        {change.error}
                      </p>
                    )}
                  </div>
                  {findMono(change.memberId) && (
                    <button
                      type="button"
                      className={button}
                      onClick={() => {
                        setOpen(false);
                        window.dispatchEvent(
                          new CustomEvent("monocode:open-team", {
                            detail: { monoId: change.memberId },
                          }),
                        );
                      }}
                    >
                      Edit
                    </button>
                  )}
                </div>
              );
            })}
            {error && (
              <p role="alert" className="mt-2 text-red-700 dark:text-red-400">
                {error}
              </p>
            )}
          </div>
        </Modal>
      )}
    </section>
  );
}
