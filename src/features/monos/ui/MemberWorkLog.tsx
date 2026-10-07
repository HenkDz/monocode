import { useSyncExternalStore } from "react";
import { findMono, monoLook, type Mono } from "../model/mono";
import { memberTasks } from "../model/monoNavigation";
import { orchestrator } from "../../orchestration/model/orchestration";
import { PixelMascot } from "../../projects/ui/PixelMascot";
import { openCardSession } from "../model/monoCards";
import { openUrl } from "@tauri-apps/plugin-opener";

/** Task snapshots are the durable work log; never copy streaming worker prose into another session. */
export function MemberWorkLog({ member }: { member: Mono }) {
  const runs = useSyncExternalStore(orchestrator.subscribe, orchestrator.snapshot, orchestrator.snapshot);
  const tasks = memberTasks(runs, member.id);
  const manager = findMono(member.reportsTo ?? ""), look = manager && monoLook(manager);
  return <section aria-label="Member work log" className="mx-auto w-full max-w-3xl space-y-3 px-4 py-4">
    {!tasks.length && <p className="text-sm text-content/50">No assignments yet. {look?.name ?? "Your Manager"} assigns work here, or ask me something.</p>}
    {tasks.map(task => <article key={task.id} data-member-task={task.id} className="rounded-lg border border-stroke p-3 text-xs">
      <div className="mb-2 flex items-center gap-2 text-content/55">{look && <PixelMascot name={look.mascot} color={look.color} still className="size-4" />}From {task.origin === "user" ? "user" : look?.name ?? "Manager"}</div>
      <div className="flex items-center gap-2"><strong className="flex-1 text-sm font-medium">{task.title}</strong><span className="rounded bg-content/5 px-2 py-1">{task.status}</span></div>
      <p className="my-2 break-all text-content/50">{task.workspace?.branch} {task.workspace?.checkoutCwd}</p>
      <details className="mb-2"><summary className="text-content/50">Assignment</summary><p className="mt-1 whitespace-pre-wrap">{task.prompt}</p></details>
      <div className="flex gap-3"><button onClick={() => openCardSession(task.sessionId)}>Open worker session</button>{task.prUrl && <button onClick={() => void openUrl(task.prUrl!)}>Open PR</button>}</div>
      {task.reviewVerdict && <p className="mt-2">Review: {task.reviewVerdict.decision} · {task.reviewVerdict.notes}</p>}
      {task.result && <div className="mt-3 border-t border-stroke pt-2"><div className="mb-1 text-content/50">Report to {look?.name ?? "Manager"}</div><p className="whitespace-pre-wrap">{task.result}</p></div>}
    </article>)}
  </section>;
}
