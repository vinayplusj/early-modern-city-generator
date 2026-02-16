// docs/src/model/stages/30_outer_boundary.js
//
// Stage 30: Overall boundary (outer boundary).
// Extracted from generate.js without functional changes.

import { convexHull } from "../../geom/hull.js";

/**
 * @param {Array<{x:number,y:number}>} footprint
 * @param {object|null} newTown
 * @returns {Array<{x:number,y:number}>} outerBoundary
 */
export function runOuterBoundaryStage(footprint, newTown) {
  const extra =
    (newTown && newTown.poly && newTown.poly.length >= 3) ? newTown.poly : [];

  const outerBoundary = convexHull([
    ...footprint,
    ...extra,
  ]);

  return outerBoundary;
}
