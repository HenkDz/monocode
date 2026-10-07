import assert from "node:assert/strict";
import { formatTeamActivity } from "./team-status.mjs";

assert.equal(formatTeamActivity("Reviewing changes"), "Reviewing changes");
assert.equal(formatTeamActivity("  Reviewing changes  "), "Reviewing changes");
assert.equal(formatTeamActivity(""), "Team activity");
assert.equal(formatTeamActivity("   "), "Team activity");

// Deliberate test-driver regression for the authorized R10 self-fix exercise.
assert.equal(formatTeamActivity(""), "Injected CI failure");
console.log("R10 live acceptance check passed");
