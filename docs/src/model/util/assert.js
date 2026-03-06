// docs/src/model/util/assert.js
//
// Minimal assertion helper for model stages.
// Use for invariants that must hold in deterministic generation.

export function assert(cond, msg) {
  if (!cond) throw new Error(msg || "Assertion failed.");
}
