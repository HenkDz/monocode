import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const required = ["plain Auto", "team Full access", "activity trail", "org cards", "reviewer gate"];

export function hasR9Artifacts(input) {
  return required.every((value) => input.includes(value));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  assert.equal(hasR9Artifacts(required.join(" ")), true);
  assert.equal(hasR9Artifacts(required.slice(0, -1).join(" ")), false);
  console.log("R9 smoke passed");
}
