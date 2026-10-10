import { compactCiRepairContext, type CiRepairRequest } from "./ciRepair";
import { dedicatedMono, type Mono } from "../../monos/model/mono";
import {
  monoManagerGoals,
  type ManagerGoalHost,
} from "../../monos/model/monoManagerGoals";

/** This picker action is a user assignment, with the same durable goal delivery as the Orchestrator. */
export async function assignManagerCiRepair(
  manager: Mono,
  project: string,
  request: CiRepairRequest,
  host: ManagerGoalHost,
  requestId = request.requestId ?? crypto.randomUUID(),
  ledger = monoManagerGoals,
) {
  if (
    manager.archivedAt != null ||
    manager.role !== "manager" ||
    dedicatedMono(project)?.id !== manager.id
  )
    throw new Error("Choose this project's current Manager.");
  return ledger.handle(
    manager.id,
    { kind: "user", messageId: requestId },
    requestId,
    "goals.assign",
    {
      projectId: project,
      goal: `${request.text}\n\n${compactCiRepairContext(request.prompt, 7500)}`,
    },
    { ...host, mayDelegate: (id) => id === manager.id },
  );
}
