// docs/src/model/stages/40_water.js

import { buildWaterModel } from "../water.js";

/**
 * @param {object} args
 * @returns {object} waterModel
 */
export function runWaterStage({ waterKind, rng, outerBoundary, cx, cy, baseR }) {
  const waterModel = (waterKind === "none")
    ? { kind: "none", river: null, coast: null, shoreline: null, bankPoint: null }
    : buildWaterModel({
        rng,            // use passed RNG
        siteWater: waterKind,
        outerBoundary,
        cx,
        cy,
        baseR,
      });

  return waterModel;
}
