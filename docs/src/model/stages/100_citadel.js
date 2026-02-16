// docs/src/model/stages/100_citadel.js
//
// Stage 100: Citadel geometry.
// Extracted from generate.js without functional changes.

import { generateBastionedWall } from "../features.js";

/**
 * @param {function} rng - seeded RNG function (mulberry32(seed)) from generate.js
 * @param {object} anchors - must contain anchors.citadel {x,y}
 * @param {number} baseR
 * @returns {Array<{x:number,y:number}>} citadel polygon
 */
export function runCitadelStage(rng, anchors, baseR) {
  const citSize = baseR * 0.1;
  const citadel = generateBastionedWall(rng, anchors.citadel.x, anchors.citadel.y, citSize, 5).wall;
  return citadel;
}
