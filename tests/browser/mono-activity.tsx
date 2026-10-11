import { createRoot } from "react-dom/client";
import { useState } from "react";
import { mockIPC } from "@tauri-apps/api/mocks";
import { MonoDetails } from "../../src/features/monos/ui/MonoDetails";
import { DeleteWorktreeDialog } from "../../src/features/source-control/ui/DeleteWorktreeDialog";
import { WorktreeRemovalTasks } from "../../src/features/source-control/ui/WorktreeRemovalTasks";
import { ProjectWorktrees } from "../../src/features/source-control/ui/ProjectWorktrees";
import type { Worktree } from "../../src/features/source-control/model/worktrees";
import type { Block } from "../../src/features/sessions/model/session";
import "../../src/styles/index.css";

const mode = new URLSearchParams(location.search).get("mode");
const blocks: Block[] = Array.from({ length: 40 }, (_, index) => ({
  id: `call-${index}`,
  role: "tool",
  text: `Inspect file ${index}`,
  tool: {
    kind: "shell",
    status: mode === "solo" ? "pending" : "completed",
    detail: `File ${index}\n${"Long command output to read with the mouse wheel.\n".repeat(8)}`,
  },
  approval: mode === "solo" ? { requestId: index } : undefined,
}));
const noop = () => {};
const trees: Worktree[] = ["main", "feature", "other"].map((branch) => ({
  path:
    branch === "main"
      ? "/fixture"
      : branch === "feature"
        ? "/fixture/worktree"
        : "/fixture/other",
  branch,
  head: "abc",
  isMain: branch === "main",
  locked: false,
  prunable: false,
  missing: false,
  dirty: false,
  unpushed: 0,
  sessionIds: [],
}));

function DeletionFixture() {
  const [confirming, setConfirming] = useState(true);
  const [view, setView] = useState("Original view");
  return (
    <>
      <WorktreeRemovalTasks />
      <ProjectWorktrees
        project="/fixture"
        currentProject="/fixture"
        enabled
        history={[]}
        openSessions={[]}
        busySessionIds={new Set()}
        approvalSessionIds={new Set()}
        unseenFinishedIds={new Set()}
        liveAgents={[]}
        onLoadHistory={async () => true}
        onSelectWorktree={() => setView("Other worktree opened")}
        onNewSession={noop}
        onSelectSession={noop}
      />
      <p>{view}</p>
      {confirming && (
        <DeleteWorktreeDialog
          cwd="/fixture"
          tree={trees[1]}
          onRemove={() =>
            new Promise<void>((resolve) =>
              Object.assign(window, { completeDeletion: resolve }),
            )
          }
          onClose={() => setConfirming(false)}
          onDeleted={() => setView("Worktree deleted")}
        />
      )}
    </>
  );
}

if (mode === "delete") {
  mockIPC((command) =>
    command === "git_worktrees"
      ? { worktrees: trees, defaultRoot: "/fixture" }
      : command === "git_diff_index"
        ? {
            files: [],
            upstream: null,
            ahead: 0,
            behind: 0,
            additions: 0,
            deletions: 0,
          }
        : command === "git_pr_list" || command === "list_external_editors"
          ? []
          : null,
  );
}

createRoot(document.getElementById("root")!).render(
  mode === "delete" ? (
    <DeletionFixture />
  ) : (
    <MonoDetails
      open
      monoId="scroll-fixture"
      cwd="/fixture"
      agent={{ name: "Captain", mascot: "cat", color: "#6ba", projects: [] }}
      state={{ status: "working" }}
      harness="codex"
      model="codex:gpt-5.4"
      modelSettings={{}}
      runtimeMode="auto"
      onModelChange={noop}
      onModelSettingsChange={noop}
      onRuntimeModeChange={noop}
      onClose={noop}
      tab="activity"
      toolActivityOpen={mode === "work"}
      teamActivity={
        mode !== "solo" ? (
          <div>
            {Array.from({ length: 20 }, (_, index) => (
              <p key={index} className="p-4">
                Team event {index}
              </p>
            ))}
          </div>
        ) : undefined
      }
      activity={{ blocks, live: true }}
    />
  ),
);
