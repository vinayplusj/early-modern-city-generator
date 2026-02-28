// docs/src/model/stages/50_wards.js
//
// Stage 50: Wards (Voronoi) + deterministic roles.
// Extracted from generate.js without functional changes.
//
// Change (2026-02-27):
// Bias seed density so central wards are smaller and outer wards are larger.
// Voronoi cell area is driven by seed density.
// - Increase spiral seed count (more interior seeds).
// - Reduce boundary seed count (fewer boundary-adjacent seeds).
// - Increase boundary inset (move boundary seeds inward), which reduces "edge crowding".

import { buildWardsVoronoi } from "../wards/wards_voronoi.js";
import { assignWardRoles } from "../wards/ward_roles.js";

const DEFAULT_WARDS_PARAMS = Object.freeze({
  // Spiral seeds (core density).
  // Increased to make inner wards smaller (higher interior seed density).
  seedCount: 48,

  spiralScale: 0,           // filled at runtime from baseR
  jitterRadius: 0,          // filled at runtime from baseR
  jitterAngle: 0.25,
  bboxPadding: 0,           // filled at runtime from baseR
  clipToFootprint: true,

  // Boundary ring seeds.
  // Reduced so boundary wards become larger (lower edge seed density).
  boundarySeedCount: 12,

  boundaryInset: 0,         // filled at runtime from baseR
});

/**
 * @param {object} args
 * @returns {object} { wardSeeds, wardsWithRoles, wardRoleIndices, fortHulls }
 */
function computeDynamicInnerCount(seed) {
  const seedInt = Math.trunc(Number.isFinite(seed) ? seed : 0);

  // Normalise JS remainder into [0, 2] even for negative seeds.
  const rem = ((seedInt % 3) + 3) % 3;

  // Final range: 3, 4, 5
  return 3 + rem;
}

export function runWardsStage({
  ctx,
  baseR,
  cx,
  cy,
  outerBoundary,
}) {
  const WARDS_PARAMS = {
    ...DEFAULT_WARDS_PARAMS,

    // Slightly tighter spiral spacing helps keep more seeds closer to centre.
    // This supports smaller inner wards without increasing boundary crowding.
    spiralScale: baseR * 0.12,

    // Keep jitter modest so the density gradient stays stable.
    jitterRadius: baseR * 0.03,

    bboxPadding: baseR * 1.2,

    // Increase inset so boundary ring seeds do not hug the boundary.
    // This makes outermost wards larger and reduces "thin slivers" at the edge.
    boundaryInset: Math.max(6, baseR * 0.04),
  };

  const { wardSeeds, wards } = buildWardsVoronoi({
    rng: ctx.rng.wards,
    centre: { x: cx, y: cy },
    footprintPoly: outerBoundary,
    params: WARDS_PARAMS,
  });

  const innerCount = computeDynamicInnerCount(ctx.seed);

  const {
    wards: wardsWithRoles,
    indices: wardRoleIndices,
    fortHulls,
  } = assignWardRoles({
    wards,
    centre: { x: cx, y: cy },
    params: { innerCount },
  });

  // Persist on ctx exactly as before.
  ctx.wards.seeds = wardSeeds;
  ctx.wards.cells = wardsWithRoles;
  ctx.wards.roleIndices = wardRoleIndices;

  return { wardSeeds, wardsWithRoles, wardRoleIndices, fortHulls };
}
