import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import {
  decideMonoGoalRoute,
  type MonoGoalRouteChoice,
  type MonoGoalRoutingContext,
} from "../model/monoGoalRouting";

export function MonoGoalRoute({
  context,
  text,
  attachmentCount,
  choice,
  onChange,
  disabled = false,
}: {
  context: MonoGoalRoutingContext;
  text: string;
  attachmentCount: number;
  choice: MonoGoalRouteChoice;
  onChange: (choice: MonoGoalRouteChoice) => void;
  disabled?: boolean;
}) {
  const route = decideMonoGoalRoute({
    text: text.trim(),
    attachmentCount,
    choice,
    context,
  });
  return (
    <div data-mono-goal-route className="px-2.5 pt-2 pb-1">
      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label="Submission mode" className="flex gap-1">
          {(["chat", "goal"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              aria-pressed={choice.mode === mode}
              disabled={disabled}
              onClick={() => onChange({ ...choice, mode })}
              className={`rounded-md px-2 py-1 text-[12px] disabled:opacity-50 ${choice.mode === mode ? "bg-content/10 text-content" : "text-content/50 hover:bg-content/5 hover:text-content"}`}
            >
              {mode === "chat" ? "Chat" : "New goal"}
            </button>
          ))}
        </div>
        {choice.mode === "goal" ? (
          <SearchableSelect
            label="Goal route"
            variant="pill"
            disabled={disabled}
            value={
              choice.override === "manager"
                ? `project:${choice.projectId}`
                : choice.override
            }
            options={[
              { value: "auto", label: "Auto route" },
              { value: "grand", label: "Grand Orch" },
              ...context.projects.map((project) => ({
                value: `project:${project.id}`,
                label: `${project.name} Manager${project.available ? "" : " (unavailable)"}`,
                keywords: project.path,
              })),
            ]}
            onChange={(value) =>
              onChange(
                value === "auto" || value === "grand"
                  ? { mode: "goal", override: value }
                  : {
                      mode: "goal",
                      override: "manager",
                      projectId: value.slice("project:".length),
                    },
              )
            }
          />
        ) : null}
      </div>
      {choice.mode === "goal" ? (
        <p role="status" className="mt-1 text-[12px] text-content/70">
          <span className="font-medium text-content">
            {route.kind === "manager"
              ? `Send to ${route.project.name} Manager`
              : "Send to Grand Orch"}
          </span>
          <span className="ml-2 text-content/45">{route.reason}</span>
        </p>
      ) : null}
    </div>
  );
}
