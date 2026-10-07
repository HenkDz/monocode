import assert from "node:assert/strict";
import { formatTeamActivity } from "./team-status.mjs";

assert.equal(formatTeamActivity("Reviewing changes"), "Reviewing changes");
assert.equal(formatTeamActivity("  Reviewing changes  "), "Reviewing changes");
assert.equal(formatTeamActivity(""), "Team activity");
assert.equal(formatTeamActivity("   "), "Team activity");

console.log("R10 live acceptance check passed");
