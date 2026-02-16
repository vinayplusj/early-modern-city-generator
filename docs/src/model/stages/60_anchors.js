// docs/src/model/stages/60_anchors.js
//
// Stage 60: Build anchors.
// Extracted from generate.js without functional changes.

import { buildAnchors } from "./anchors.js";

/**
 * @param {object} ctx
 * @returns {object} anchors
 */
export function runAnchorsStage(ctx) {
  const anchors = buildAnchors(ctx);
  return anchors;
}
