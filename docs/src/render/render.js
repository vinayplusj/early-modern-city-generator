// docs/src/render/render.js
//
// Canvas renderer for Milestone 3.4.
// Expects a model object from docs/src/model/generate.js.
//
// Draw order (important for visibility):
// 1) background + water + footprint + outer boundary
// 2) New Town polygon + streets
// 3) glacis + ditch rings + ravelins
// 4) walls + rings
// 5) road graph
// 6) gates + primary gate
// 7) citadel
// 8) landmarks (square + market + docks) LAST so they are always visible
// 9) centre marker (reference)

import { drawBackground } from "./stages/background.js";
import { drawWater } from "./stages/water.js";
import { drawFootprintAndDebugOverlays } from "./stages/footprint_debug.js";
import { drawBoundaryAndNewTown } from "./stages/boundary_newtown.js";
import { drawMoatworksAndRavelins } from "./stages/moatworks_ravelins.js";
import { drawWallsAndRingsAndWarp } from "./stages/walls_rings_warp.js";
import { drawRoadGraph } from "./stages/roads.js";
import { drawGatesAndPrimaryGate } from "./stages/gates.js";
import { drawCitadel } from "./stages/citadel.js";
import { drawLandmarksAndCentre } from "./stages/landmarks.js";
import { drawWardsDebug } from "./stages/wards_debug.js";

// ---------- Public render ----------
export function render(ctx, model) {
  const {
    footprint,
    outerBoundary,
    site,
    water,

    wall,
    wallBase,
    bastionPolys,
    ring,
    ring2,

    ditchOuter,
    ditchInner,
    glacisOuter,

    ravelins,

    cx,
    cy,
    squareR,
    citadel,
    anchors,

    roadGraph,
    newTown,
    blocks,
    warp,
  } = model || {};

  const A = anchors || {};

  const gates = A.gates || null;
  const primaryGate = A.primaryGate || null;

  drawBackground(ctx);
  drawWater(ctx, { water });

  drawFootprintAndDebugOverlays(ctx, {
    footprint,
    outerBoundary,
    districts: model?.districts,
    blocks,
  });

  drawWardsDebug(ctx, {
    wards: model?.wards,
    wardSeeds: model?.wardSeeds,
    wardRoleIndices: model?.wardRoleIndices,
    anchors: A,
  });

  drawBoundaryAndNewTown(ctx, { outerBoundary, newTown });

  drawMoatworksAndRavelins(ctx, { glacisOuter, ditchOuter, ditchInner, ravelins });

  drawWallsAndRingsAndWarp(ctx, {
    wall,
    wallBase,
    bastionPolys,
    ring,
    ring2,
    warp,
  });

  drawRoadGraph(ctx, { roadGraph });

  drawGatesAndPrimaryGate(ctx, { gates, primaryGate, cx, cy, squareR });

  drawCitadel(ctx, { citadel, anchors: A });

  drawLandmarksAndCentre(ctx, {
    wallBase,
    outerBoundary,
    squareR,
    anchors: A,
    site,
  });
}
