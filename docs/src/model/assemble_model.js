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

  mesh,
  vorGraph,

  // 4.7 hooks (outer boundary binding + gate portals)
  boundaryBinding,
  gatePortals,

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
  primaryRoadsMeta,
  primaryRoadsSnappedNodes,
  primaryRoadsGateForRoad,
  ring,
  ring2,
  secondaryRoads,
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
  const safeBaseR = Number.isFinite(baseR) ? baseR : 0;

  const wallCurtain =
    (Array.isArray(wallCurtainForDraw) && wallCurtainForDraw.length >= 3)
      ? wallCurtainForDraw
      : wallBase;

  const wall = (Array.isArray(wallForDraw) && wallForDraw.length >= 2) ? wallForDraw : null;
  const bastionPolys = Array.isArray(bastionPolysWarpedSafe) ? bastionPolysWarpedSafe : [];
  const gates = Array.isArray(gatesWarped) ? gatesWarped : [];

  const roadsArr = Array.isArray(roads) ? roads : null;
  const primaryRoadsArr = Array.isArray(primaryRoads) ? primaryRoads : roadsArr;

  const primaryRoadsMetaArr = Array.isArray(primaryRoadsMeta) ? primaryRoadsMeta : [];
  const primaryRoadsSnapsObj = (primaryRoadsSnappedNodes && typeof primaryRoadsSnappedNodes === "object")
    ? primaryRoadsSnappedNodes
    : null;
  const primaryRoadsGatePoint = (primaryRoadsGateForRoad && Number.isFinite(primaryRoadsGateForRoad.x) && Number.isFinite(primaryRoadsGateForRoad.y))
    ? primaryRoadsGateForRoad
    : null;

  const secondaryRoadsArr = Array.isArray(secondaryRoads)
    ? secondaryRoads
    : secondaryRoadsLegacy;

  return {
    footprint,
    cx,
    cy,
    debug,

    // Walls + moatworks
    wallBase,
    wallCurtain,
    wall,
    bastionPolys,
    bastionHull,
    gates,
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

    mesh: (mesh && typeof mesh === "object")
      ? { ...mesh, vorGraph: mesh.vorGraph ?? vorGraph ?? null }
      : { vorGraph: vorGraph ?? null },

    // 4.7 hooks
    boundaryBinding: boundaryBinding ?? null,
    gatePortals: Array.isArray(gatePortals) ? gatePortals : null,

    // Anchors
    centre,
    squareR: safeBaseR * 0.055,
    citadel,
    avenue,
    primaryGate: primaryGateWarped,

    site,
    water: waterModel,

    // Roads
    roads: roadsArr,
    primaryRoads: primaryRoadsArr,
    primaryRoadsMeta: primaryRoadsMetaArr,
    primaryRoadsSnappedNodes: primaryRoadsSnapsObj,
    primaryRoadsGateForRoad: primaryRoadsGatePoint,
    ring,
    ring2,
    secondaryRoads: secondaryRoadsArr,
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
  };
}
