// docs/src/model/stages/130_docks.js
//
// Stage 130: Docks anchor.
// Extracted from generate.js without functional changes.

import { buildDocks } from "./docks.js";

/**
 * @param {object} args
 * @returns {object|null} docks point or null
 */
export function runDocksStage(args) {
  return buildDocks(args);
}
