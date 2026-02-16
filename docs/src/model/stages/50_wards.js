// docs/src/model/stages/50_wards.js
//
// Stage 50: Wards (Voronoi) + deterministic roles.
// Extracted from generate.js without functional changes.

import { buildWardsVoronoi } from "../wards/wards_voronoi.js";
import { assignWardRoles } from "../wards/ward_roles.js";

const DEFAULT_WARDS_PARAMS = Object.freeze({
  seedCount: 24,            // spiral seeds (core density)
  spiralScale: 0,           // filled at runtime from baseR
  jitterRadius: 0,          // filled at runtime from baseR
  jitterAngle: 0.25,
  bboxPadding: 0,           // filled at runtime from baseR
  clipToFootprint: true,

  // boundary ring to create more “rings” and reduce skew
  boundarySeedCount: 16,
  boundaryInset: 0,         // filled at runtime from baseR
});

/**
 * @param {object} args
 * @returns {object} { wardSeeds, wardsWithRoles, wardRoleIndices, fortHulls }
 */
export function runWardsStage({
  ctx,
  baseR,
  cx,
  cy,
  outerBoundary,
}) {
  const WARDS_PARAMS = {
    ...DEFAULT_WARDS_PARAMS,
    spiralScale: baseR * 0.14,
    jitterRadius: baseR * 0.03,
    bboxPadding: baseR * 1.2,
    boundaryInset: Math.max(4, baseR * 0.015),
  };

  const { wardSeeds, wards } = buildWardsVoronoi({
    rng: ctx.rng.wards,
    centre: { x: cx, y: cy },
    footprintPoly: outerBoundary,
    params: WARDS_PARAMS,
  });

  const {
    wards: wardsWithRoles,
    indices: wardRoleIndices,
    fortHulls,
  } = assignWardRoles({
    wards,
    centre: { x: cx, y: cy },
    params: { innerCount: 8 },
  });

  // Persist on ctx exactly as before.
  ctx.wards.seeds = wardSeeds;
  ctx.wards.cells = wardsWithRoles;
  ctx.wards.roleIndices = wardRoleIndices;

  return { wardSeeds, wardsWithRoles, wardRoleIndices, fortHulls };
}
