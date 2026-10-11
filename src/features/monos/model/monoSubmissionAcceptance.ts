export type MonoSubmissionAcceptance =
  | { kind: "accepted" }
  | { kind: "rejected"; error?: string }
  | { kind: "uncertain"; error: string };

// The native floating bridge preserves error strings, not Error subclasses.
export const MONO_SUBMISSION_REJECTED = "mono_submission_rejected";
const REJECTED_MESSAGE = "The message could not be sent. Try again in a moment.";

export function monoSubmissionAcceptance(accepted: boolean | void): MonoSubmissionAcceptance {
  return { kind: accepted === false ? "rejected" : "accepted" };
}

export function monoSubmissionFailure(reason: unknown): { kind: "rejected" | "uncertain"; error: string } {
  const error = reason instanceof Error ? reason.message : String(reason);
  return error === MONO_SUBMISSION_REJECTED
    ? { kind: "rejected", error: REJECTED_MESSAGE }
    : { kind: "uncertain", error };
}
