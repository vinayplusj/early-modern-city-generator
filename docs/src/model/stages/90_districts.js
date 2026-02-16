// docs/src/model/stages/90_districts.js
//
// Stage 90: Districts (Voronoi role groups).
// Extracted from generate.js without functional changes.

import { buildVoronoiDistrictsFromWards } from "../districts_voronoi.js";

/**
 * @param {Array<object>} wardsWithRoles
 * @param {number} cx
 * @param {number} cy
 * @returns {Array<object>} districts
 */
export function runDistrictsStage(wardsWithRoles, cx, cy) {
  return buildVoronoiDistrictsFromWards({
    wards: wardsWithRoles,
    centre: { x: cx, y: cy },
  });
}
