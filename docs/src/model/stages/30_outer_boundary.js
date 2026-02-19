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
  // Milestone deferral: New Town must not affect the city outer boundary.
  // Keep the parameter for now to avoid re-threading call sites.
  void newTown;
  const outerBoundary = convexHull(footprint);

  return outerBoundary;
}
