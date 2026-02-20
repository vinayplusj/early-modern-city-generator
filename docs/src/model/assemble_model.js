// docs/src/model/assemble_model.js
//
// Assemble the final model object consumed by rendering.
// This module must preserve the exact return shape and semantics from generate.js.

export function assembleModel({
  footprint,
  cx,
  cy,
  debug,
  // Walls + moatworks
  wallBase,
  wallCurtainForDraw,
  wallForDraw,
  bastionPolysWarpedSafe,
  bastionHull,
  gatesWarped,
  ravelins,
  ditchOuter,
  ditchInner,
  glacisOuter,
  ditchWidth,
  glacisWidth,

  districts,
  blocks,
  warpWall,
  warpOutworks,
  fortHulls,

  wardsWithRoles,
  wardSeeds,
  wardRoleIndices,

  vorGraph,

  // Anchors
  centre,
  baseR,
  citadel,
  avenue,
  primaryGateWarped,

  site,
  waterModel,

  // Roads
  roads,
  primaryRoads,
  ring,
  ring2,
  secondaryRoadsLegacy,
  roadGraph,

  // New Town
  newTown,

  // District-ish boundary
  outerBoundary,

  // Markers
  gatesOriginal,
  landmarks,
  anchors,
}) {
  return {
    footprint,
    cx,
    cy,
    debug,
    // Walls + moatworks
    wallBase,
    wallCurtain: wallCurtainForDraw || wallBase,
    wall: wallForDraw,
    bastionPolys: bastionPolysWarpedSafe,
    bastionHull,
    gates: gatesWarped,
    ravelins,
    ditchOuter,
    ditchInner,
    glacisOuter,
    ditchWidth,
    glacisWidth,

    districts,
    blocks,
    warp: {
      wall: warpWall ?? null,
      outworks: warpOutworks ?? null,
    },
    fortHulls,

    wards: wardsWithRoles,
    wardSeeds,
    wardRoleIndices,

    mesh: {
      vorGraph,
    },

    // Anchors
    centre,
    squareR: baseR * 0.055,
    citadel,
    avenue,
    primaryGate: primaryGateWarped,

    site,
    water: waterModel,

    // Roads
    roads,
    primaryRoads,
    ring,
    ring2,
    secondaryRoads: secondaryRoadsLegacy,
    roadGraph,

    // New Town
    newTown,

    // District-ish boundary
    outerBoundary,

    // Markers
    gatesOriginal,
    landmarks,
    anchors,
  };
}
