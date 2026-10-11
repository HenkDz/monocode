import { expect, it } from "vitest";
import { MONO_SUBMISSION_REJECTED, monoSubmissionAcceptance, monoSubmissionFailure } from "./monoSubmissionAcceptance";

it("distinguishes acceptance, explicit rejection and possible persistence", () => {
  expect(monoSubmissionAcceptance(true)).toEqual({ kind: "accepted" });
  expect(monoSubmissionAcceptance(undefined)).toEqual({ kind: "accepted" });
  expect(monoSubmissionAcceptance(false)).toEqual({ kind: "rejected" });
  for (const reason of [MONO_SUBMISSION_REJECTED, Error(MONO_SUBMISSION_REJECTED)])
    expect(monoSubmissionFailure(reason)).toEqual({ kind: "rejected", error: "The message could not be sent. Try again in a moment." });
  for (const reason of ["Origin saved; acknowledgement interrupted", Error("Origin saved; acknowledgement interrupted"), "The message could not be sent. Try again in a moment."])
    expect(monoSubmissionFailure(reason)).toEqual({ kind: "uncertain", error: reason instanceof Error ? reason.message : reason });
});
