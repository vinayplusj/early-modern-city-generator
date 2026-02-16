// docs/src/model/stages/40_water.js
//
// Stage 40: Water (river/coast) initial model.
// Extracted from generate.js without functional changes.

import { buildWaterModel } from "../water.js";

/**
 * Build the initial geometric water model (legacy).
 * Snapping to the routing mesh happens later.
 *
 * @param {object} args
 * @returns {object} waterModel
 */
export function runWaterStage({
  waterKind,
  ctx,
  outerBoundary,
  cx,
  cy,
  baseR,
}) {
  const waterModel = (waterKind === "none")
    ? { kind: "none", river: null, coast: null, shoreline: null, bankPoint: null }
    : buildWaterModel({
        rng: ctx.rng.water,
        siteWater: waterKind,
        outerBoundary,
        cx,
        cy,
        baseR,
      });

  return waterModel;
}
