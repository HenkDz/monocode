import { isMonoSession } from "../../../features/monos/model/mono";
import { habitRunMono } from "../../../features/monos/model/monoHabits";
import { sameProviderAccountId } from "../../../features/providers/model/providerAccounts";
import { monoWorkingDirectoryNeedsResume } from "../../../features/monos/model/monoWorkingDirectoryMigration";
import type { HarnessSessionInput, SendTurnInput } from "../core/types";

/** A Mono's folder may move while its account and saved conversation stay the same. */
export function canResumeMonoAfterCwdChange(
  input: HarnessSessionInput & Pick<SendTurnInput, "monoSession" | "orgMono">,
  resume: { cwd: string; providerAccountId?: string; acpSessionId?: string; sessionId?: string } | undefined,
): boolean {
  return !!resume && (resume.cwd !== input.cwd || monoWorkingDirectoryNeedsResume(input.sessionId, resume.acpSessionId ?? resume.sessionId)) &&
    (input.monoSession === true || input.orgMono === true || isMonoSession(input.sessionId) || !!habitRunMono(input.sessionId)) &&
    sameProviderAccountId(resume.providerAccountId, input.providerAccountId);
}
